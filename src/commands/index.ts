import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from '../config/config.js';
import { indexWorkspace, type IndexResult } from '../indexing/indexer.js';
import { runConfiguredHook } from '../utils/hooks.js';
import { runIndexWithProgress } from '../tui/progress/IndexProgressApp.js';
import type { RepoStatus } from '../tui/progress/RepoStatusList.js';
import { updateSpinnerOnProgress } from '../tui/progress/spinnerProgress.js';
import { shouldUseInteractive } from '../utils/interactive.js';
import { notify } from '../utils/notify.js';

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

export async function indexCommand(opts: { force?: boolean; interactive?: boolean; plain?: boolean; notify?: boolean }) {
  // Validate workspace before starting so errors are actionable rather than mid-spinner surprises.
  let preflightConfig: Awaited<ReturnType<typeof loadWorkspaceConfig>>;
  try {
    preflightConfig = await loadWorkspaceConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNotFound = /ENOENT|no such file|not found/i.test(message);
    if (isNotFound) {
      console.error(chalk.red('✗') + ' No ctxhub workspace found here.');
      console.error(chalk.gray('  Run: ctxhub init'));
    } else if (/Cannot find module|native addon|NODE_MODULE/i.test(message)) {
      console.error(chalk.red('✗') + ' ctxhub failed to load the LanceDB index engine.');
      console.error(chalk.gray('  Try: npm install -g ctxhub@latest'));
      console.error(chalk.gray('  Or set provider: local-json in ctxhub.yaml to use the fallback index.'));
    } else {
      console.error(chalk.red('✗') + ` Failed to load workspace config: ${message}`);
    }
    process.exit(1);
  }

  if (preflightConfig.config.repositories.length === 0) {
    console.error(chalk.yellow('!') + ' No repositories configured — nothing to index.');
    console.error(chalk.gray('  Run: ctxhub repo add <name> <path>'));
    process.exit(1);
  }

  let result: IndexResult;
  try {
    if (shouldUseInteractive(opts)) {
      const { result: interactiveResult, repos } = await runIndexWithProgress(process.cwd(), Boolean(opts.force));
      result = interactiveResult;
      printRepoStatuses(repos);
      printSummary(result);
    } else {
      const spinner = ora('Indexing workspace knowledge').start();
      result = await indexWorkspace(process.cwd(), Boolean(opts.force), updateSpinnerOnProgress(spinner, 'Indexing workspace knowledge'));
      spinner.succeed('Index complete');
      printSummary(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot find module|native addon|NODE_MODULE/i.test(message)) {
      console.error(chalk.red('✗') + ' ctxhub failed to load the LanceDB index engine.');
      console.error(chalk.gray('  Try: npm install -g ctxhub@latest'));
      console.error(chalk.gray('  Or set provider: local-json in ctxhub.yaml to use the fallback index.'));
    } else {
      console.error(chalk.red('✗') + ` Indexing failed: ${message}`);
    }
    process.exit(1);
  }

  if (opts.notify) {
    notify('ctxhub index', `Indexed ${result.indexed}, skipped ${result.skipped}, deleted ${result.deleted}.`);
  }

  await runConfiguredHook(preflightConfig.config, 'postIndex');
}
