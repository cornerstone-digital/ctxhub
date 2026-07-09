import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { attachFreshness } from './freshness.js';
import { classifyResult, localRgHints } from './searchFacets.js';
import type { SearchResult } from '../config/types.js';

export async function createContextPack(query: string, limit = 8, cwd = process.cwd()) {
  const { loadWorkspaceConfig } = await import('../config/config.js');
  const { config, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const memory = createMemoryAdapter(config.memory.provider, config.memory.path, workspaceRoot);
  const [searchResults, architectureResults, memoryStatus, indexStatus] = await Promise.all([
    index.search(query, limit),
    index.search(`architecture diagram mermaid ${query}`, limit),
    memory.status(),
    index.status()
  ]);

  const search = await attachFreshness(config, searchResults, workspaceRoot);
  const architecture = (await attachFreshness(config, architectureResults, workspaceRoot))
    .filter(result => result.kind === 'architecture-diagram');

  return {
    query,
    workspace: config.workspace.name,
    generatedAt: new Date().toISOString(),
    repos: config.repositories,
    status: { memory: memoryStatus, index: indexStatus },
    search,
    architecture,
    resultTypes: countResultTypes(search),
    suggestedReadingOrder: suggestedReadingOrder(search, architecture),
    localFollowUpCommands: localRgHints(query, search),
    guidance: [
      'Use search results for grounded citations.',
      'Use architecture results first for topology, component, and relationship questions.',
      'For exact method bodies or implementation edits, use the suggested local rg commands inside the target repo after ctxhub identifies where to look.',
      'Treat results with freshness.stale=true as suspect until ctxhub sync/index runs.'
    ]
  };
}

function countResultTypes(search: SearchResult[]) {
  const counts: Record<string, number> = {};
  for (const result of search) {
    const type = classifyResult(result);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function suggestedReadingOrder(search: Array<{ repo: string; filePath: string; title?: string }>, architecture: Array<{ repo: string; filePath: string; title?: string }>) {
  const seen = new Set<string>();
  return [...architecture, ...search]
    .map(result => ({
      repo: result.repo,
      path: result.filePath,
      title: result.title
    }))
    .filter(item => {
      const key = `${item.repo}:${item.path}:${item.title ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}
