import type { IndexedChunk } from '../config/types.js';
import { loadManifest, manifestKey, saveManifest } from './manifest.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from './providers.js';
import { sha256 } from '../utils/hash.js';
import { buildFileSummaryChunkWithLlm, chunkDocument, extractTitle, type ChunkTrustTier } from './chunk.js';
import { redactContent } from './redact.js';
import { mapWithConcurrencyLimit } from '../utils/concurrency.js';
import { loadCtxhubIgnorePatterns } from './ctxhubignore.js';
import type { Evidence, EvidenceSource } from './evidenceSource.js';
import { createEvidenceSource, createGitEvidenceSource } from './evidenceSources/index.js';

export type IndexResult = {
  scanned: number;
  indexed: number;
  skipped: number;
  deleted: number;
};

export type IndexProgressEvent =
  | { type: 'repo-start'; repo: string }
  | { type: 'repo-progress'; repo: string; scanned: number; total: number }
  | { type: 'repo-missing'; repo: string }
  | { type: 'repo-done'; repo: string; scanned: number; indexed: number; skipped: number };

// How often (ms) to emit a repo-progress event while scanning a source's items. Time-based
// rather than count-based so it scales correctly regardless of source size or how slow
// individual items are to hash/chunk/index.
const PROGRESS_THROTTLE_MS = 100;

// Reading, hashing, chunking, and the optional per-item LLM summary call are I/O/subprocess-bound,
// not CPU-bound -- real OS threads (worker_threads) wouldn't help here, since Node's event loop
// already runs concurrent I/O fine on its own. This is the default number of items whose "prepare"
// step (everything up to but not including the actual index write) runs concurrently; the actual
// write to the index provider still happens one item at a time, in the order pulled from the
// source, since overlapping multi-step writes isn't guaranteed safe for every IndexProvider
// implementation. Batched (not one single pool over the whole source) so peak memory only grows
// by this many items' worth of pending chunks at a time, not the entire source's.
const DEFAULT_INDEX_CONCURRENCY = 8;

type PreparedItem =
  | { type: 'skip'; key: string }
  | {
      type: 'index';
      key: string;
      sourceId: string;
      absolutePath: string;
      commit?: string;
      hash: string;
      chunks: IndexedChunk[];
      existingChunkIds?: string[];
    };

// Pulls up to `size` items from an async iterator. A GitEvidenceSource/LandRegistryEvidenceSource
// etc. already batches its own internal work (e.g. concurrent file reads); this just groups
// whatever comes out of `fetch()` into fixed-size windows so the prepare step below can run
// concurrently across them without materializing the whole source's evidence in memory.
async function takeBatch<T>(iterator: AsyncIterator<T>, size: number): Promise<T[]> {
  const batch: T[] = [];
  for (let i = 0; i < size; i++) {
    const { value, done } = await iterator.next();
    if (done) break;
    batch.push(value);
  }
  return batch;
}

export async function indexWorkspace(
  cwd = process.cwd(),
  force = false,
  onProgress?: (event: IndexProgressEvent) => void
): Promise<IndexResult> {
  const { config, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const manifest = await loadManifest(config.workspace.name, workspaceRoot);

  const result: IndexResult = { scanned: 0, indexed: 0, skipped: 0, deleted: 0 };
  const seenKeys = new Set<string>();
  const concurrency = config.index.concurrency ?? DEFAULT_INDEX_CONCURRENCY;

  // Load .ctxhubignore patterns once for the whole workspace run. Merged into each git
  // source's exclude list so they apply to every file fast-glob scans.
  const ignorePatterns = await loadCtxhubIgnorePatterns(workspaceRoot);

  // ADR-020: a workspace's evidence sources are its repositories plus whatever non-git
  // EvidenceSource adapters are configured -- additive, no privileged kind.
  const sources: EvidenceSource[] = [
    ...config.repositories.map(repo =>
      createGitEvidenceSource(repo, workspaceRoot, config.knowledge.include, config.knowledge.exclude, ignorePatterns, concurrency)
    ),
    ...(config.evidenceSources ?? []).map(createEvidenceSource)
  ];

  try {
  for (const source of sources) {
    if (!(await source.detect())) {
      onProgress?.({ type: 'repo-missing', repo: source.name });
      continue;
    }

    onProgress?.({ type: 'repo-start', repo: source.name });
    const sourceCounts = { scanned: 0, indexed: 0, skipped: 0 };

    let iterationFailed = false;
    let total = 0;
    let iterator: AsyncIterator<Evidence>;
    try {
      const fetched = await source.fetch();
      total = fetched.total;
      iterator = fetched.items[Symbol.asyncIterator]();
    } catch (err) {
      console.warn(`[indexer] ${source.name}: ${err instanceof Error ? err.message : String(err)}`);
      onProgress?.({ type: 'repo-done', repo: source.name, ...sourceCounts });
      continue;
    }

    onProgress?.({ type: 'repo-progress', repo: source.name, scanned: 0, total });
    let lastProgressAt = Date.now();

    while (true) {
      let batch: Evidence[];
      try {
        batch = await takeBatch(iterator, concurrency);
      } catch (err) {
        console.warn(`[indexer] ${source.name}: ${err instanceof Error ? err.message : String(err)}`);
        iterationFailed = true;
        break;
      }
      if (batch.length === 0) break;

      // Prepare runs concurrently across the batch -- hash, redact, chunk, and the optional
      // LLM summary call are all independent per item. Promise ordering guarantees `prepared`
      // comes back in the same order as `batch`, so the commit phase below stays deterministic.
      const prepared = await mapWithConcurrencyLimit(batch, concurrency, async (evidence): Promise<PreparedItem> => {
        const key = manifestKey(source.name, evidence.sourceId);

        if (evidence.unreadable) {
          return { type: 'skip', key };
        }

        const hash = sha256(evidence.content);
        const existing = manifest.files[key];
        if (!force && existing?.hash === hash) {
          return { type: 'skip', key };
        }

        const redaction = redactContent(evidence.content, config.privacy.redactPatterns);
        const title = extractTitle(redaction.content);
        const parts = chunkDocument(evidence.sourceId, redaction.content, config.index.chunkSize);
        const summaryChunk = await buildFileSummaryChunkWithLlm(evidence.sourceId, title, parts, redaction.content, config);
        // Appended, not prepended -- keeps every existing chunk's index (and therefore its
        // deterministic id) unchanged when this feature is added to an already-indexed item.
        const allParts = summaryChunk ? [...parts, summaryChunk] : parts;

        // Detect trust tier from YAML frontmatter (git sources) or default to 'unverified'
        // (every other source today -- freshly-fetched evidence has no trust of its own,
        // per ADR-020/ADR-008; it earns trust through review and promotion, not on arrival).
        const explicitTierMatch = evidence.content.match(/^trust-tier\s*:\s*(\S+)/m);
        const explicitTier = explicitTierMatch?.[1] as ChunkTrustTier | undefined;
        const validTiers: ChunkTrustTier[] = ['unverified', 'reviewed', 'promoted', 'institutional', 'canonical'];
        const trustTier: ChunkTrustTier =
          explicitTier && validTiers.includes(explicitTier)
            ? explicitTier
            : /^promoted-from\s*:/m.test(evidence.content) ? 'promoted' : 'unverified';

        const absolutePath = typeof evidence.metadata.absolutePath === 'string' ? evidence.metadata.absolutePath : evidence.sourceId;
        const commit = typeof evidence.metadata.commit === 'string' ? evidence.metadata.commit : undefined;

        const chunks: IndexedChunk[] = allParts.map((part, i) => ({
          id: sha256(`${source.name}:${evidence.sourceId}:${hash}:${i}`),
          workspace: config.workspace.name,
          repo: source.name,
          filePath: evidence.sourceId,
          absolutePath,
          kind: part.kind ?? 'document',
          diagramType: part.diagramType,
          components: part.components,
          relationships: part.relationships,
          symbol: part.symbol,
          symbolKind: part.symbolKind,
          title: part.heading ?? title,
          content: part.content,
          redacted: redaction.redacted,
          hash,
          commit,
          lastIndexed: new Date().toISOString(),
          trustTier,
        }));

        return { type: 'index', key, sourceId: evidence.sourceId, absolutePath, commit, hash, chunks, existingChunkIds: existing?.chunkIds };
      });

      // Commit runs strictly sequentially -- one item's write to the index provider fully
      // completes before the next starts, so multi-step writes (remove-then-add, conditional
      // index creation) never overlap, regardless of how the prepare phase above interleaved.
      for (const item of prepared) {
        result.scanned++;
        sourceCounts.scanned++;
        seenKeys.add(item.key);

        const now = Date.now();
        if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
          onProgress?.({ type: 'repo-progress', repo: source.name, scanned: sourceCounts.scanned, total });
          lastProgressAt = now;
        }

        if (item.type === 'skip') {
          result.skipped++;
          sourceCounts.skipped++;
          continue;
        }

        if (item.existingChunkIds?.length) {
          await index.removeDocuments(item.existingChunkIds);
        }

        await index.indexDocuments(item.chunks);
        manifest.files[item.key] = {
          repo: source.name,
          filePath: item.sourceId,
          absolutePath: item.absolutePath,
          hash: item.hash,
          commit: item.commit,
          indexedAt: new Date().toISOString(),
          chunkIds: item.chunks.map(c => c.id)
        };
        result.indexed++;
        sourceCounts.indexed++;
      }
    }

    // A mid-run fetch failure (network blip, etc.) shouldn't be treated the same as "this
    // item no longer exists" -- mark this source's already-indexed entries as seen so the
    // stale-cleanup pass below doesn't delete previously-indexed content over a transient error.
    if (iterationFailed) {
      for (const [key, entry] of Object.entries(manifest.files)) {
        if (entry.repo === source.name) seenKeys.add(key);
      }
    }

    onProgress?.({ type: 'repo-done', repo: source.name, ...sourceCounts });
  }

  for (const [key, entry] of Object.entries(manifest.files)) {
    if (!seenKeys.has(key)) {
      await index.removeDocuments(entry.chunkIds);
      delete manifest.files[key];
      result.deleted++;
    }
  }

  await index.flush?.();
  } finally {
    await saveManifest(manifest, workspaceRoot);
  }
  return result;
}
