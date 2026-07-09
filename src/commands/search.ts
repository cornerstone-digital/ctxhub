import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';
import { runInteractiveSearch } from '../tui/SearchApp.js';
import { shouldUseInteractive } from '../utils/interactive.js';
import { classifyResult, filterResults, localRgHints, normalizeSearchFacet, type SearchFacet } from '../context/searchFacets.js';

export async function searchCommand(
  query: string | undefined,
  opts: { limit?: string; interactive?: boolean; plain?: boolean; type?: string; code?: boolean; docs?: boolean; architecture?: boolean; notes?: boolean }
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const facet = selectedFacet(opts);

  if ((opts.interactive && !opts.plain) || shouldUseInteractive(opts)) {
    if (!process.stdin.isTTY) {
      throw new Error('--interactive needs a real terminal (stdin is not a TTY). Run ctxhub search "<query>" instead.');
    }
    await runInteractiveSearch(config, workspaceRoot, query ?? '', Number(opts.limit ?? 5), facet);
    return;
  }

  if (!query) {
    throw new Error('Provide a query, or pass --interactive to search live.');
  }

  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const limit = Number(opts.limit ?? 5);
  const candidates = await attachFreshness(config, await index.search(query, searchLimit(limit, facet)), workspaceRoot);
  const results = filterResults(candidates, facet).slice(0, limit);

  if (!results.length) {
    console.log(chalk.yellow(`No ${facet === 'all' ? '' : `${facet} `}results.`));
    return;
  }

  for (const chunk of results) {
    const label = classifyResult(chunk);
    console.log(`\n${chalk.green(chunk.repo)} ${chalk.gray(chunk.filePath)} ${chalk.cyan(`[${label}]`)}`);
    if (chunk.title) console.log(chalk.bold(chunk.title));
    if (chunk.symbol) console.log(chalk.gray(`${chunk.symbolKind ?? 'symbol'} ${chunk.symbol}`));
    const freshness = chunk.freshness?.stale ? chalk.yellow(` · stale: ${chunk.freshness.reason}`) : '';
    console.log(chalk.gray(`id ${chunk.id.slice(0, 12)} · score ${chunk.score}${chunk.commit ? ` · ${chunk.commit.slice(0, 7)}` : ''}`) + freshness);
    console.log(chunk.snippet);
    console.log(chalk.gray(`open: ctxhub open ${chunk.id.slice(0, 12)}`));
  }

  const hints = localRgHints(query, results);
  if (hints.length) {
    console.log(`\n${chalk.bold('Local follow-up')}`);
    for (const hint of hints) console.log(chalk.gray(hint));
  }
}

function selectedFacet(opts: { type?: string; code?: boolean; docs?: boolean; architecture?: boolean; notes?: boolean }): SearchFacet {
  const shortcutFacets = [
    opts.code ? 'code' : undefined,
    opts.docs ? 'docs' : undefined,
    opts.architecture ? 'architecture' : undefined,
    opts.notes ? 'notes' : undefined
  ].filter(Boolean);

  if (shortcutFacets.length > 1) {
    throw new Error('Choose only one search type flag: --code, --docs, --architecture, or --notes.');
  }

  return normalizeSearchFacet(shortcutFacets[0] ?? opts.type);
}

function searchLimit(limit: number, facet: SearchFacet): number {
  return facet === 'all' ? limit : Math.max(limit * 5, 25);
}
