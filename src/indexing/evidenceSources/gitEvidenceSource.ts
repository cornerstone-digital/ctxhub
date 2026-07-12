import path from 'node:path';
import { stat } from 'node:fs/promises';
import fg from 'fast-glob';
import type { RepoConfig } from '../../config/types.js';
import type { Evidence, EvidenceSource } from '../evidenceSource.js';
import { pathExists, readText } from '../../utils/fs.js';
import { getCurrentCommit } from '../../git/git.js';
import { mapWithConcurrencyLimit } from '../../utils/concurrency.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function repoInclude(repo: RepoConfig, globalInclude: string[]): string[] {
  return repo.include?.length ? repo.include : globalInclude;
}

function repoExclude(repo: RepoConfig, globalExclude: string[]): string[] {
  return repo.exclude?.length ? repo.exclude : globalExclude;
}

/**
 * ADR-020: git is the first EvidenceSource adapter. This is a pure extraction of the
 * fast-glob walk + per-file read that indexWorkspace always did directly -- same include/
 * exclude merging, same size guard, same commit-stamping. No behavior change for existing
 * git workspaces.
 */
export class GitEvidenceSource implements EvidenceSource {
  readonly kind = 'git';
  readonly name: string;
  private readonly repoPath: string;

  constructor(
    private readonly repo: RepoConfig,
    workspaceRoot: string,
    private readonly globalInclude: string[],
    private readonly globalExclude: string[],
    private readonly ignorePatterns: string[],
    private readonly concurrency: number
  ) {
    this.name = repo.name;
    this.repoPath = path.resolve(workspaceRoot, repo.path);
  }

  async detect(): Promise<boolean> {
    return pathExists(this.repoPath);
  }

  async fetch(): Promise<{ total: number; items: AsyncIterable<Evidence> }> {
    const files = await fg(repoInclude(this.repo, this.globalInclude), {
      cwd: this.repoPath,
      ignore: [...repoExclude(this.repo, this.globalExclude), ...this.ignorePatterns],
      onlyFiles: true,
      dot: false
    });

    const commit = await getCurrentCommit(this.repoPath);
    return { total: files.length, items: this.readFiles(files, commit) };
  }

  private async *readFiles(files: string[], commit: string | undefined): AsyncIterable<Evidence> {
    for (let i = 0; i < files.length; i += this.concurrency) {
      const batch = files.slice(i, i + this.concurrency);

      // Same reasoning as indexer.ts's old inline batching: bounds peak memory to this
      // many files' content at a time rather than the whole repo's.
      const read = await mapWithConcurrencyLimit(batch, this.concurrency, async (filePath): Promise<Evidence> => {
        const absolutePath = path.join(this.repoPath, filePath);
        const fileStat = await stat(absolutePath).catch(() => null);
        if (!fileStat || fileStat.size > MAX_FILE_BYTES) {
          const reason = fileStat ? `file too large (${fileStat.size} bytes)` : 'stat failed';
          console.warn(`[indexer] skipping ${filePath}: ${reason}`);
          return { sourceId: filePath, content: '', metadata: { repo: this.repo.name, absolutePath }, unreadable: reason };
        }
        const content = await readText(absolutePath);
        return { sourceId: filePath, content, metadata: { repo: this.repo.name, absolutePath, commit } };
      });

      for (const item of read) {
        yield item;
      }
    }
  }
}
