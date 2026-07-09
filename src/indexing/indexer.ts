import path from 'node:path';
import fg from 'fast-glob';
import type { IndexedChunk, RepoConfig } from '../config/types.js';
import { loadManifest, manifestKey, saveManifest } from './manifest.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from './providers.js';
import { pathExists, readText } from '../utils/fs.js';
import { sha256 } from '../utils/hash.js';
import { getCurrentCommit } from '../git/git.js';
import { chunkDocument, extractTitle } from './chunk.js';
import { redactContent } from './redact.js';

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
      ignore: repoExclude(repo, config.knowledge.exclude),
      onlyFiles: true,
      dot: false
    });

    const commit = await getCurrentCommit(repoPath);

    onProgress?.({ type: 'repo-progress', repo: repo.name, scanned: 0, total: files.length });
    let lastProgressAt = Date.now();

    for (const filePath of files) {
      result.scanned++;
      repoCounts.scanned++;

      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        onProgress?.({ type: 'repo-progress', repo: repo.name, scanned: repoCounts.scanned, total: files.length });
        lastProgressAt = now;
      }

      const absolutePath = path.join(repoPath, filePath);
      const raw = await readText(absolutePath);
      const hash = sha256(raw);
      const redaction = redactContent(raw, config.privacy.redactPatterns);
      const key = manifestKey(repo.name, filePath);
      seenKeys.add(key);

      const existing = manifest.files[key];
      if (!force && existing?.hash === hash) {
        result.skipped++;
        repoCounts.skipped++;
        continue;
      }

      if (existing?.chunkIds?.length) {
        await index.removeDocuments(existing.chunkIds);
      }

      const title = extractTitle(redaction.content);
      const parts = chunkDocument(filePath, redaction.content, config.index.chunkSize);
      const chunks: IndexedChunk[] = parts.map((part, i) => ({
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
        lastIndexed: new Date().toISOString()
      }));

      await index.indexDocuments(chunks);
      manifest.files[key] = {
        repo: repo.name,
        filePath,
        absolutePath,
        hash,
        commit,
        indexedAt: new Date().toISOString(),
        chunkIds: chunks.map(c => c.id)
      };
      result.indexed++;
      repoCounts.indexed++;
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

  await saveManifest(manifest, workspaceRoot);
  return result;
}
