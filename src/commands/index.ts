import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { runConfiguredHook } from '../utils/hooks.js';

export async function indexCommand(opts: { force?: boolean }) {
  const spinner = ora('Indexing workspace knowledge').start();
  const result = await indexWorkspace(process.cwd(), Boolean(opts.force));
  spinner.succeed('Index complete');

  console.log(`${chalk.green('✓')} scanned: ${result.scanned}`);
  console.log(`${chalk.green('✓')} indexed: ${result.indexed}`);
  console.log(`${chalk.gray('•')} skipped: ${result.skipped}`);
  console.log(`${chalk.yellow('•')} deleted: ${result.deleted}`);

  const config = await loadConfig();
  await runConfiguredHook(config, 'postIndex');
}
