import chalk from 'chalk';
import { loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';

export async function searchCommand(query: string, opts: { limit?: string }) {
  const config = await loadConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const results = await attachFreshness(config, await index.search(query, Number(opts.limit ?? 5)));

  if (!results.length) {
    console.log(chalk.yellow('No results.'));
    return;
  }

  for (const chunk of results) {
    console.log(`\n${chalk.green(chunk.repo)} ${chalk.gray(chunk.filePath)}`);
    if (chunk.title) console.log(chalk.bold(chunk.title));
    const freshness = chunk.freshness?.stale ? chalk.yellow(` · stale: ${chunk.freshness.reason}`) : '';
    console.log(chalk.gray(`score ${chunk.score}${chunk.commit ? ` · ${chunk.commit.slice(0, 7)}` : ''}`) + freshness);
    console.log(chunk.snippet);
  }
}
