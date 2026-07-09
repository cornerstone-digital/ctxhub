import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from '../config/config.js';
import { indexWorkspace, type IndexResult } from '../indexing/indexer.js';
import { runConfiguredHook } from '../utils/hooks.js';
import { runIndexWithProgress } from '../tui/progress/IndexProgressApp.js';
import type { RepoStatus } from '../tui/progress/RepoStatusList.js';
import { updateSpinnerOnProgress } from '../tui/progress/spinnerProgress.js';
import { shouldUseInteractive } from '../utils/interactive.js';

function printSummary(result: IndexResult) {
  console.log(`${chalk.green('✓')} scanned: ${result.scanned}`);
  console.log(`${chalk.green('✓')} indexed: ${result.indexed}`);
  console.log(`${chalk.gray('•')} skipped: ${result.skipped}`);
  console.log(`${chalk.yellow('•')} deleted: ${result.deleted}`);
}

function printRepoStatuses(repos: RepoStatus[]) {
  for (const repo of repos) {
    const icon = repo.state === 'missing' ? chalk.yellow('!') : repo.state === 'error' ? chalk.red('✗') : chalk.green('✓');
    console.log(`${icon} ${repo.name}${repo.detail ? ` — ${repo.detail}` : ''}`);
  }
}

export async function indexCommand(opts: { force?: boolean; interactive?: boolean; plain?: boolean }) {
  if (shouldUseInteractive(opts)) {
    const { result, repos } = await runIndexWithProgress(process.cwd(), Boolean(opts.force));
    printRepoStatuses(repos);
    printSummary(result);
  } else {
    const spinner = ora('Indexing workspace knowledge').start();
    const result = await indexWorkspace(process.cwd(), Boolean(opts.force), updateSpinnerOnProgress(spinner, 'Indexing workspace knowledge'));
    spinner.succeed('Index complete');
    printSummary(result);
  }

  const { config } = await loadWorkspaceConfig();
  await runConfiguredHook(config, 'postIndex');
}
