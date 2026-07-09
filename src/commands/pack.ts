import chalk from 'chalk';
import { createContextPack } from '../context/pack.js';
import { createContextPackArtifact } from '../context/export.js';
import { writeText } from '../utils/fs.js';

export async function packCommand(query: string, opts: { limit?: string; json?: boolean; out?: string; includeAbsolutePaths?: boolean } = {}) {
  const pack = await createContextPack(query, Number(opts.limit ?? 8));
  if (opts.out) {
    const artifact = await createContextPackArtifact(pack, { includeAbsolutePaths: opts.includeAbsolutePaths });
    await writeText(opts.out, `${JSON.stringify(artifact, null, 2)}\n`);
    if (opts.json) {
      console.log(JSON.stringify(artifact, null, 2));
      return;
    }
    console.log(chalk.green(`Wrote context pack artifact: ${opts.out}`));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }

  console.log(chalk.bold(`Context pack: ${pack.query}`));
  console.log(chalk.gray(`Workspace: ${pack.workspace} · generated ${pack.generatedAt}`));
  console.log(chalk.gray(`Result types: ${formatCounts(pack.resultTypes)}`));
  console.log(`\n${chalk.bold('Suggested Reading Order')}`);
  for (const item of pack.suggestedReadingOrder) {
    console.log(`${chalk.green(item.repo)} ${chalk.gray(item.path)}${item.title ? ` — ${item.title}` : ''}`);
  }

  if (pack.localFollowUpCommands.length) {
    console.log(`\n${chalk.bold('Local Follow-up')}`);
    for (const command of pack.localFollowUpCommands) console.log(chalk.gray(command));
  }

  console.log(`\n${chalk.bold('Search Results')}`);
  for (const result of pack.search.slice(0, Number(opts.limit ?? 8))) {
    const stale = result.freshness?.stale ? chalk.yellow(' stale') : '';
    console.log(`${chalk.green(result.repo)} ${chalk.gray(result.filePath)}${stale}`);
    if (result.title) console.log(chalk.bold(result.title));
    console.log(result.snippet);
  }
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([type, count]) => `${type} ${count}`).join(' · ') : 'none';
}
