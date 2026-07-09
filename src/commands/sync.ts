import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { pullRepo } from '../git/git.js';

export async function syncCommand(opts: { noPull?: boolean }) {
  const config = await loadConfig();

  if (!opts.noPull) {
    for (const repo of config.repositories) {
      const spinner = ora(`Pulling ${repo.name}`).start();
      try {
        await pullRepo(repo.path);
        spinner.succeed(`Pulled ${repo.name}`);
      } catch (error) {
        spinner.warn(`Could not pull ${repo.name}: ${(error as Error).message}`);
      }
    }
  }

  const spinner = ora('Re-indexing changed knowledge').start();
  const result = await indexWorkspace();
  spinner.succeed('Workspace synced');
  console.log(`${chalk.green('✓')} indexed ${result.indexed} changed file(s), skipped ${result.skipped}`);
}
