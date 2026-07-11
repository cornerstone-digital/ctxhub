import path from 'node:path';
import { stat } from 'node:fs/promises';
import fg from 'fast-glob';
import type { IndexedChunk, RepoConfig } from '../config/types.js';
import { loadManifest, manifestKey, saveManifest } from './manifest.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from './providers.js';
import { pathExists, readText } from '../utils/fs.js';
import { sha256 } from '../utils/hash.js';
import { getCurrentCommit } from '../git/git.js';
import { buildFileSummaryChunkWithLlm, chunkDocument, extractTitle, type ChunkTrustTier } from './chunk.js';
import { redactContent } from './redact.js';
import { mapWithConcurrencyLimit } from '../utils/concurrency.js';
import { loadCtxhubIgnorePatterns } from './ctxhubignore.js';

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

// How often (ms) to emit a repo-progress event while scanning a repo's files. Time-based
// rather than count-based so it scales correctly regardless of repo size or how slow
// individual files are to hash/chunk/index -- a huge repo of tiny files and a smaller
// repo of a few huge files both get an update roughly this often, not too chatty either way.
const PROGRESS_THROTTLE_MS = 100;

// Reading, hashing, chunking, and the optional per-file LLM summary call are I/O/subprocess-bound,
// not CPU-bound -- real OS threads (worker_threads) wouldn't help here, since Node's event loop
// already runs concurrent I/O fine on its own. This is the default number of files whose "prepare"
// step (everything up to but not including the actual index write) runs concurrently; the actual
// write to the index provider still happens one file at a time, in original file order, since
// overlapping multi-step writes isn't guaranteed safe for every IndexProvider implementation.
// Batched (not one single pool over the whole repo) so peak memory only grows by this many files'
// worth of pending chunks at a time, not the entire repo's.
const DEFAULT_INDEX_CONCURRENCY = 8;

type PreparedFile =
  | { type: 'skip'; key: string }
  | {
      type: 'index';
      key: string;
      filePath: string;
      absolutePath: string;
      hash: string;
      chunks: IndexedChunk[];
      existingChunkIds?: string[];
    };

function repoInclude(repo: RepoConfig, globalInclude: string[]): string[] {
  return repo.include?.length ? repo.include : globalInclude;
}

function repoExclude(repo: RepoConfig, globalExclude: string[]): string[] {
  return repo.exclude?.length ? repo.exclude : globalExclude;
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

  // Load .ctxhubignore patterns once for the whole workspace run. Merged into
  // each repo's exclude list so they apply to every file fast-glob scans.
  const ignorePatterns = await loadCtxhubIgnorePatterns(workspaceRoot);

  try {
  for (const repo of config.repositories) {
    const repoPath = path.resolve(workspaceRoot, repo.path);
    if (!(await pathExists(repoPath))) {
      onProgress?.({ type: 'repo-missing', repo: repo.name });
      continue;
    }

    onProgress?.({ type: 'repo-start', repo: repo.name });
    const repoCounts = { scanned: 0, indexed: 0, skipped: 0 };

    const files = await fg(repoInclude(repo, config.knowledge.include), {
      cwd: repoPath,
      ignore: [...repoExclude(repo, config.knowledge.exclude), ...ignorePatterns],
      onlyFiles: true,
      dot: false
    });

    const commit = await getCurrentCommit(repoPath);

    onProgress?.({ type: 'repo-progress', repo: repo.name, scanned: 0, total: files.length });
    let lastProgressAt = Date.now();

    const concurrency = config.index.concurrency ?? DEFAULT_INDEX_CONCURRENCY;

    for (let batchStart = 0; batchStart < files.length; batchStart += concurrency) {
      const batch = files.slice(batchStart, batchStart + concurrency);

      // Prepare runs concurrently across the batch -- read, hash, redact, chunk, and the
      // optional LLM summary call are all independent per file. Promise ordering guarantees
      // `prepared` comes back in the same order as `batch`, so the commit phase below stays
      // deterministic (progress/counts/manifest updates happen in original file order)
      // regardless of which file's prepare step actually finished first.
      const prepared = await mapWithConcurrencyLimit(batch, concurrency, async (filePath): Promise<PreparedFile> => {
        const absolutePath = path.join(repoPath, filePath);
        const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
        const key = manifestKey(repo.name, filePath);
        const fileStat = await stat(absolutePath).catch(() => null);
        if (!fileStat || fileStat.size > MAX_FILE_BYTES) {
          console.warn(`[indexer] skipping ${filePath}: ${fileStat ? `file too large (${fileStat.size} bytes)` : 'stat failed'}`);
          return { type: 'skip', key };
        }
        const raw = await readText(absolutePath);
        const hash = sha256(raw);

        const existing = manifest.files[key];
        if (!force && existing?.hash === hash) {
          return { type: 'skip', key };
        }

        const redaction = redactContent(raw, config.privacy.redactPatterns);
        const title = extractTitle(redaction.content);
        const parts = chunkDocument(filePath, redaction.content, config.index.chunkSize);
        const summaryChunk = await buildFileSummaryChunkWithLlm(filePath, title, parts, redaction.content, config);
        // Appended, not prepended -- keeps every existing chunk's index (and therefore its
        // deterministic id) unchanged when this feature is added to an already-indexed file.
        const allParts = summaryChunk ? [...parts, summaryChunk] : parts;

        // Detect trust tier from YAML frontmatter.
        // Explicit `trust-tier: <tier>` wins if present (written by captainNoteTemplate for
        // promoted captain runs, or set manually).
        // Notes promoted from MemPalace carry `promoted-from: mempalace:...` and are given
        // the 'promoted' tier as a fallback.
        // All other documents default to 'unverified'.
        const explicitTierMatch = raw.match(/^trust-tier\s*:\s*(\S+)/m);
        const explicitTier = explicitTierMatch?.[1] as ChunkTrustTier | undefined;
        const validTiers: ChunkTrustTier[] = ['unverified', 'reviewed', 'promoted', 'institutional', 'canonical'];
        const trustTier: ChunkTrustTier =
          explicitTier && validTiers.includes(explicitTier)
            ? explicitTier
            : /^promoted-from\s*:/m.test(raw) ? 'promoted' : 'unverified';

        const chunks: IndexedChunk[] = allParts.map((part, i) => ({
          id: sha256(`${repo.name}:${filePath}:${hash}:${i}`),
          workspace: config.workspace.name,
          repo: repo.name,
          filePath,
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

        return { type: 'index', key, filePath, absolutePath, hash, chunks, existingChunkIds: existing?.chunkIds };
      });

      // Commit runs strictly sequentially -- one file's write to the index provider fully
      // completes before the next starts, so multi-step writes (remove-then-add, conditional
      // index creation) never overlap, regardless of how the prepare phase above interleaved.
      for (const item of prepared) {
        result.scanned++;
        repoCounts.scanned++;
        seenKeys.add(item.key);

        const now = Date.now();
        if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
          onProgress?.({ type: 'repo-progress', repo: repo.name, scanned: repoCounts.scanned, total: files.length });
          lastProgressAt = now;
        }

        if (item.type === 'skip') {
          result.skipped++;
          repoCounts.skipped++;
          continue;
        }

        if (item.existingChunkIds?.length) {
          await index.removeDocuments(item.existingChunkIds);
        }

        await index.indexDocuments(item.chunks);
        manifest.files[item.key] = {
          repo: repo.name,
          filePath: item.filePath,
          absolutePath: item.absolutePath,
          hash: item.hash,
          commit,
          indexedAt: new Date().toISOString(),
          chunkIds: item.chunks.map(c => c.id)
        };
        result.indexed++;
        repoCounts.indexed++;
      }
    }

    onProgress?.({ type: 'repo-done', repo: repo.name, ...repoCounts });
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
