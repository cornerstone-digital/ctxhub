import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { pullRepo } from '../git/git.js';
import { runConfiguredHook } from '../utils/hooks.js';
import { runSyncWithProgress } from '../tui/progress/SyncProgressApp.js';
import type { RepoStatus } from '../tui/progress/RepoStatusList.js';

function printRepoStatuses(label: string, repos: RepoStatus[]) {
  console.log(chalk.bold(label));
  for (const repo of repos) {
    const icon = repo.state === 'missing' ? chalk.yellow('!') : repo.state === 'error' ? chalk.red('✗') : chalk.green('✓');
    console.log(`${icon} ${repo.name}${repo.detail ? ` — ${repo.detail}` : ''}`);
  }
}

export async function syncCommand(opts: { pull?: boolean }) {
  // Commander's `--no-pull` option surfaces as `opts.pull === false`, not `opts.noPull`
  // (there is no `noPull` property) -- `--no-pull` silently never worked before this fix.
  const noPull = opts.pull === false;
  const config = await loadConfig();

  if (process.stdout.isTTY) {
    const { pullResults, indexResults, result } = await runSyncWithProgress(process.cwd(), noPull);
    if (!noPull) {
      printRepoStatuses('Pulled repositories', pullResults);
      await runConfiguredHook(config, 'postPull');
    }
    printRepoStatuses('Re-indexed repositories', indexResults);
    console.log(`${chalk.green('✓')} indexed ${result.indexed} changed file(s), skipped ${result.skipped}`);
  } else {
    if (!noPull) {
      for (const repo of config.repositories) {
        const spinner = ora(`Pulling ${repo.name}`).start();
        try {
          await pullRepo(repo.path);
          spinner.succeed(`Pulled ${repo.name}`);
        } catch (error) {
          spinner.warn(`Could not pull ${repo.name}: ${(error as Error).message}`);
        }
      }

      await runConfiguredHook(config, 'postPull');
    }

    const spinner = ora('Re-indexing changed knowledge').start();
    const result = await indexWorkspace();
    spinner.succeed('Workspace synced');
    console.log(`${chalk.green('✓')} indexed ${result.indexed} changed file(s), skipped ${result.skipped}`);
  }

  await runConfiguredHook(config, 'postIndex');
}
