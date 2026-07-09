import type { SearchResult } from '../config/types.js';
import { isSourceFile } from './symbols.js';

export const SEARCH_FACETS = ['all', 'docs', 'code', 'architecture', 'notes'] as const;
export type SearchFacet = (typeof SEARCH_FACETS)[number];

export function classifyResult(result: Pick<SearchResult, 'kind' | 'filePath' | 'symbol'>): Exclude<SearchFacet, 'all'> {
  if (result.kind === 'architecture-diagram') return 'architecture';
  if (/agent-notes\//i.test(result.filePath)) return 'notes';
  if (result.symbol || isSourceFile(result.filePath)) return 'code';
  return 'docs';
}

export function filterResults<T extends Pick<SearchResult, 'kind' | 'filePath' | 'symbol'>>(results: T[], facet: SearchFacet): T[] {
  if (facet === 'all') return results;
  return results.filter(result => classifyResult(result) === facet);
}

export function normalizeSearchFacet(value?: string): SearchFacet {
  if (!value) return 'all';
  if ((SEARCH_FACETS as readonly string[]).includes(value)) return value as SearchFacet;
  throw new Error(`Unsupported search type: ${value}. Supported: ${SEARCH_FACETS.join(', ')}`);
}

export function localRgHints(query: string, results: SearchResult[], limit = 3): string[] {
  const terms = query.match(/[A-Za-z0-9_./-]{3,}/g) ?? [];
  const needle = terms.sort((a, b) => b.length - a.length)[0];
  if (!needle) return [];

  const repos = [...new Set(results.filter(result => classifyResult(result) === 'code').map(result => result.repo))].slice(0, limit);
  return repos.map(repo => `rg ${JSON.stringify(needle)} ${repo}`);
}
