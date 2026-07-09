import type { IndexProgressEvent } from '../../indexing/indexer.js';
import type { RepoStatus } from './RepoStatusList.js';

export function applyIndexProgress(repos: RepoStatus[], event: IndexProgressEvent): RepoStatus[] {
  return repos.map(repo => {
    if (repo.name !== event.repo) return repo;
    if (event.type === 'repo-start') return { ...repo, state: 'active' };
    if (event.type === 'repo-missing') return { ...repo, state: 'missing', detail: 'path missing' };
    return { ...repo, state: 'done', detail: `${event.scanned} scanned, ${event.indexed} indexed, ${event.skipped} skipped` };
  });
}
