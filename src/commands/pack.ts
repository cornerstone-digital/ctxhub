import chalk from 'chalk';
import { createContextPack } from '../context/pack.js';

export async function packCommand(query: string, opts: { limit?: string; json?: boolean } = {}) {
  const pack = await createContextPack(query, Number(opts.limit ?? 8));
  if (opts.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }

  console.log(chalk.bold(`Context pack: ${pack.query}`));
  console.log(chalk.gray(`Workspace: ${pack.workspace} · generated ${pack.generatedAt}`));
  console.log(`\n${chalk.bold('Suggested Reading Order')}`);
  for (const item of pack.suggestedReadingOrder) {
    console.log(`${chalk.green(item.repo)} ${chalk.gray(item.path)}${item.title ? ` — ${item.title}` : ''}`);
  }

  console.log(`\n${chalk.bold('Search Results')}`);
  for (const result of pack.search.slice(0, Number(opts.limit ?? 8))) {
    const stale = result.freshness?.stale ? chalk.yellow(' stale') : '';
    console.log(`${chalk.green(result.repo)} ${chalk.gray(result.filePath)}${stale}`);
    if (result.title) console.log(chalk.bold(result.title));
    console.log(result.snippet);
  }
}
