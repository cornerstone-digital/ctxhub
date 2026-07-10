import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { attachFreshness } from './freshness.js';
import { classifyResult, localRgHints } from './searchFacets.js';
import { trimToTokenBudget } from '../utils/tokenEstimate.js';
import type { SearchResult } from '../config/types.js';

// The architecture sub-query prepends fixed keywords to the *entire* raw question
// (below), which dilutes lexical scoring for long natural-language questions -- a
// diagram's compact indexed content (component/relationship lists) can lose to
// `limit` unrelated results before ever reaching the kind==='architecture-diagram'
// filter. Search a much wider pool here, then filter and slice to the requested
// limit afterward, so a long question doesn't crowd out the one diagram that matters.
const ARCHITECTURE_SEARCH_POOL = 30;

export async function createContextPack(query: string, limit = 8, cwd = process.cwd(), opts: { maxTokens?: number } = {}) {
  const { loadWorkspaceConfig } = await import('../config/config.js');
  const { config, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const memory = createMemoryAdapter(config.memory.provider, config.memory.path, workspaceRoot);
  const [searchResults, architectureCandidates, memoryStatus, indexStatus] = await Promise.all([
    index.search(query, limit),
    index.search(`architecture diagram mermaid ${query}`, Math.max(limit, ARCHITECTURE_SEARCH_POOL)),
    memory.status(),
    index.status()
  ]);

  const architecture = (await attachFreshness(config, architectureCandidates, workspaceRoot))
    .filter(result => result.kind === 'architecture-diagram')
    .slice(0, limit);

  // A file can legitimately match both sub-queries (e.g. an architecture doc whose prose also
  // matches the main query) -- keep it in the more specific `architecture` section only, rather
  // than shipping its content twice.
  const architectureIds = new Set(architecture.map(result => result.id));
  const dedupedSearch = (await attachFreshness(config, searchResults, workspaceRoot)).filter(result => !architectureIds.has(result.id));

  // Optional token budget alongside the item-count `limit`, so a handful of large chunks can't
  // blow past what's reasonable regardless of how few of them there are. Dropped ids are still
  // named so an agent can `open_chunk` one deliberately if it decides it actually needs it.
  const { kept: search, droppedIds: droppedSearchIds } =
    opts.maxTokens !== undefined ? trimToTokenBudget(dedupedSearch, opts.maxTokens) : { kept: dedupedSearch, droppedIds: [] as string[] };

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
    ],
    ...(droppedSearchIds.length ? { droppedSearchIds } : {})
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
