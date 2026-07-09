import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';
import { runInteractiveSearch } from '../tui/SearchApp.js';
import { shouldUseInteractive } from '../utils/interactive.js';

export async function searchCommand(query: string | undefined, opts: { limit?: string; interactive?: boolean; plain?: boolean }) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();

  if ((opts.interactive && !opts.plain) || shouldUseInteractive(opts)) {
    if (!process.stdin.isTTY) {
      throw new Error('--interactive needs a real terminal (stdin is not a TTY). Run ctxhub search "<query>" instead.');
    }
    await runInteractiveSearch(config, workspaceRoot, query ?? '', Number(opts.limit ?? 5));
    return;
  }

  if (!query) {
    throw new Error('Provide a query, or pass --interactive to search live.');
  }

  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const results = await attachFreshness(config, await index.search(query, Number(opts.limit ?? 5)), workspaceRoot);

  if (!results.length) {
    console.log(chalk.yellow('No results.'));
    return;
  }

  for (const chunk of results) {
    console.log(`\n${chalk.green(chunk.repo)} ${chalk.gray(chunk.filePath)}`);
    if (chunk.title) console.log(chalk.bold(chunk.title));
    const freshness = chunk.freshness?.stale ? chalk.yellow(` · stale: ${chunk.freshness.reason}`) : '';
    console.log(chalk.gray(`id ${chunk.id.slice(0, 12)} · score ${chunk.score}${chunk.commit ? ` · ${chunk.commit.slice(0, 7)}` : ''}`) + freshness);
    console.log(chunk.snippet);
    console.log(chalk.gray(`open: ctxhub open ${chunk.id.slice(0, 12)}`));
  }
}
