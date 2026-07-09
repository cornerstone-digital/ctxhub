import path from 'node:path';
import fg from 'fast-glob';
import type { IndexedChunk, RepoConfig } from '../config/types.js';
import { loadManifest, manifestKey, saveManifest } from './manifest.js';
import { loadConfig } from '../config/config.js';
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

function repoInclude(repo: RepoConfig, globalInclude: string[]): string[] {
  return repo.include?.length ? repo.include : globalInclude;
}

function repoExclude(repo: RepoConfig, globalExclude: string[]): string[] {
  return repo.exclude?.length ? repo.exclude : globalExclude;
}

export async function indexWorkspace(cwd = process.cwd(), force = false): Promise<IndexResult> {
  const config = await loadConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
  const manifest = await loadManifest(config.workspace.name, cwd);

  const result: IndexResult = { scanned: 0, indexed: 0, skipped: 0, deleted: 0 };
  const seenKeys = new Set<string>();

  for (const repo of config.repositories) {
    const repoPath = path.resolve(cwd, repo.path);
    if (!(await pathExists(repoPath))) continue;

    const files = await fg(repoInclude(repo, config.knowledge.include), {
      cwd: repoPath,
      ignore: repoExclude(repo, config.knowledge.exclude),
      onlyFiles: true,
      dot: false
    });

    const commit = await getCurrentCommit(repoPath);

    for (const filePath of files) {
      result.scanned++;
      const absolutePath = path.join(repoPath, filePath);
      const raw = await readText(absolutePath);
      const hash = sha256(raw);
      const redaction = redactContent(raw, config.privacy.redactPatterns);
      const key = manifestKey(repo.name, filePath);
      seenKeys.add(key);

      const existing = manifest.files[key];
      if (!force && existing?.hash === hash) {
        result.skipped++;
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
    }
  }

  for (const [key, entry] of Object.entries(manifest.files)) {
    if (!seenKeys.has(key)) {
      await index.removeDocuments(entry.chunkIds);
      delete manifest.files[key];
      result.deleted++;
    }
  }

  await saveManifest(manifest, cwd);
  return result;
}
