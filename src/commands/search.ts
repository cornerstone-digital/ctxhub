import chalk from 'chalk';
import type { CtxhubConfig } from '../config/types.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';
import { runInteractiveSearch } from '../tui/SearchApp.js';
import { shouldUseInteractive } from '../utils/interactive.js';
import { classifyResult, filterResults, localRgHints, normalizeSearchFacet, type SearchFacet } from '../context/searchFacets.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';

export async function searchCommand(
  query: string | undefined,
  opts: {
    limit?: string;
    interactive?: boolean;
    plain?: boolean;
    type?: string;
    code?: boolean;
    docs?: boolean;
    architecture?: boolean;
    notes?: boolean;
    rewriteQuery?: boolean;
  },
  deps: { runAgentPromptFn?: typeof runAgentPrompt } = {}
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

  const rewrite = opts.rewriteQuery
    ? await maybeRewriteSearchInput(query, facet, config, deps.runAgentPromptFn ?? runAgentPrompt)
    : { query, facet };

  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const limit = Number(opts.limit ?? 5);
  const candidates = await attachFreshness(config, await index.search(rewrite.query, searchLimit(limit, rewrite.facet)), workspaceRoot);
  const results = filterResults(candidates, rewrite.facet).slice(0, limit);

  if (rewrite.notice) {
    console.log(chalk.dim(rewrite.notice));
  }
  if (rewrite.rewritten) {
    console.log(chalk.gray(`Original query: ${query} (${facet})`));
    console.log(chalk.gray(`Rewritten query: ${rewrite.query} (${rewrite.facet})`));
  }

  if (!results.length) {
    console.log(chalk.yellow(`No ${rewrite.facet === 'all' ? '' : `${rewrite.facet} `}results.`));
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

  const hints = localRgHints(rewrite.query, results);
  if (hints.length) {
    console.log(`\n${chalk.bold('Local follow-up')}`);
    for (const hint of hints) console.log(chalk.gray(hint));
  }
}

export async function maybeRewriteSearchInput(
  query: string,
  facet: SearchFacet,
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<{ query: string; facet: SearchFacet; rewritten?: true; notice?: string }> {
  if (!config.llm.enabled) {
    return { query, facet, notice: llmDisabledNotice('query rewriting') };
  }

  const result = await runAgentPromptFn(config, buildQueryRewritePrompt(query, facet));
  if (!result.ok) {
    return { query, facet, notice: `Query rewriting was unavailable (${result.reason}); running the original query.` };
  }

  const rewritten = parseQueryRewrite(result.text);
  if (!rewritten) {
    return { query, facet, notice: 'Query rewriting returned an invalid response; running the original query.' };
  }

  const nextQuery = rewritten.query || query;
  const nextFacet = normalizeSearchFacet(rewritten.type ?? facet);
  const changed = normalizeQuery(query) !== normalizeQuery(nextQuery) || nextFacet !== facet;
  return changed ? { query: nextQuery, facet: nextFacet, rewritten: true } : { query, facet };
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

function buildQueryRewritePrompt(query: string, facet: SearchFacet): string {
  return [
    'You are rewriting a ctxhub search query for better retrieval in a multi-repo workspace.',
    `Original query: ${query}`,
    `Current type filter: ${facet}`,
    '',
    'Return strict JSON only with this shape:',
    '{"query":"rewritten query","type":"all|docs|code|architecture|notes"}',
    'Guidelines:',
    '- Keep the intent the same; improve specificity, not meaning.',
    '- Choose a narrower type only when clearly warranted.',
    '- If no improvement is needed, return the original query and type unchanged.'
  ].join('\n');
}

function parseQueryRewrite(raw: string): { query?: string; type?: string } | undefined {
  try {
    const normalized = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(normalized) as { query?: unknown; type?: unknown };
    return {
      query: typeof parsed.query === 'string' ? parsed.query.trim() : undefined,
      type: typeof parsed.type === 'string' ? parsed.type.trim() : undefined
    };
  } catch {
    return undefined;
  }
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
