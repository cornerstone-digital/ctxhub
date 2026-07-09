import chalk from 'chalk';
import ora from 'ora';
import { indexWorkspace } from '../indexing/indexer.js';

export async function indexCommand(opts: { force?: boolean }) {
  const spinner = ora('Indexing workspace knowledge').start();
  const result = await indexWorkspace(process.cwd(), Boolean(opts.force));
  spinner.succeed('Index complete');

  console.log(`${chalk.green('✓')} scanned: ${result.scanned}`);
  console.log(`${chalk.green('✓')} indexed: ${result.indexed}`);
  console.log(`${chalk.gray('•')} skipped: ${result.skipped}`);
  console.log(`${chalk.yellow('•')} deleted: ${result.deleted}`);
}
