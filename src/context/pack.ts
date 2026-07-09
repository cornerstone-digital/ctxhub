import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { attachFreshness } from './freshness.js';

export async function createContextPack(query: string, limit = 8, cwd = process.cwd()) {
  const { loadConfig } = await import('../config/config.js');
  const config = await loadConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
  const memory = createMemoryAdapter(config.memory.provider, config.memory.path, cwd);
  const [searchResults, architectureResults, memoryStatus, indexStatus] = await Promise.all([
    index.search(query, limit),
    index.search(`architecture diagram mermaid ${query}`, limit),
    memory.status(),
    index.status()
  ]);

  const search = await attachFreshness(config, searchResults, cwd);
  const architecture = (await attachFreshness(config, architectureResults, cwd))
    .filter(result => result.kind === 'architecture-diagram');

  return {
    query,
    workspace: config.workspace.name,
    generatedAt: new Date().toISOString(),
    repos: config.repositories,
    status: { memory: memoryStatus, index: indexStatus },
    search,
    architecture,
    suggestedReadingOrder: suggestedReadingOrder(search, architecture),
    guidance: [
      'Use search results for grounded citations.',
      'Use architecture results first for topology, component, and relationship questions.',
      'Treat results with freshness.stale=true as suspect until ctxhub sync/index runs.'
    ]
  };
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
