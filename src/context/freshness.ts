import path from 'node:path';
import type { CtxhubConfig, FreshnessStatus, SearchResult } from '../config/types.js';
import { getCurrentCommit, isGitRepo, runGit } from '../git/git.js';
import { pathExists } from '../utils/fs.js';

export async function freshnessForRepo(config: CtxhubConfig, repoName: string, indexedCommit?: string, cwd = process.cwd()): Promise<FreshnessStatus> {
  const repo = config.repositories.find(candidate => candidate.name === repoName);
  if (!repo) {
    return { indexedCommit, repoMissing: true, dirty: false, stale: true, reason: 'repo is no longer configured' };
  }

  const repoPath = path.resolve(cwd, repo.path);
  if (!(await pathExists(repoPath))) {
    return { indexedCommit, repoMissing: true, dirty: false, stale: true, reason: 'repo path is missing' };
  }

  if (!(await isGitRepo(repoPath))) {
    return { indexedCommit, repoMissing: false, dirty: false, stale: false, reason: 'repo is not a git repo' };
  }

  const [currentCommit, dirty] = await Promise.all([getCurrentCommit(repoPath), isDirty(repoPath)]);
  const stale = Boolean(indexedCommit && currentCommit && indexedCommit !== currentCommit) || dirty;
  return {
    currentCommit,
    indexedCommit,
    repoMissing: false,
    dirty,
    stale,
    reason: stale ? (dirty ? 'repo has uncommitted changes' : 'repo HEAD differs from indexed commit') : undefined
  };
}

export async function attachFreshness(config: CtxhubConfig, results: SearchResult[], cwd = process.cwd()): Promise<SearchResult[]> {
  return Promise.all(results.map(async result => ({
    ...result,
    freshness: await freshnessForRepo(config, result.repo, result.commit, cwd)
  })));
}

async function isDirty(repoPath: string): Promise<boolean> {
  try {
    return (await runGit(['status', '--porcelain'], repoPath)).length > 0;
  } catch {
    return false;
  }
}
