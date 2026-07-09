import type { IndexProgressEvent } from '../../indexing/indexer.js';
import type { RepoStatus } from './RepoStatusList.js';

export function applyIndexProgress(repos: RepoStatus[], event: IndexProgressEvent): RepoStatus[] {
  return repos.map(repo => {
    if (repo.name !== event.repo) return repo;
    if (event.type === 'repo-start') return { ...repo, state: 'active' };
    if (event.type === 'repo-progress') return { ...repo, state: 'active', detail: formatFileProgress(event.scanned, event.total) };
    if (event.type === 'repo-missing') return { ...repo, state: 'missing', detail: 'path missing' };
    return { ...repo, state: 'done', detail: `${event.scanned} scanned, ${event.indexed} indexed, ${event.skipped} skipped` };
  });
}

export function formatFileProgress(scanned: number, total: number): string {
  if (total <= 0) return `${scanned} files`;
  const percent = Math.round((scanned / total) * 100);
  return `${scanned}/${total} files (${percent}%)`;
}
