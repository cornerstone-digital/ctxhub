import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { pullRepo } from '../git/git.js';
import { runConfiguredHook } from '../utils/hooks.js';
import { runSyncWithProgress } from '../tui/progress/SyncProgressApp.js';
import type { RepoStatus } from '../tui/progress/RepoStatusList.js';
import { updateSpinnerOnProgress } from '../tui/progress/spinnerProgress.js';
import { shouldUseInteractive } from '../utils/interactive.js';
import { notify } from '../utils/notify.js';
import { syncToCloud, getSyncConfig } from '../cloud/sync.js';

function printRepoStatuses(label: string, repos: RepoStatus[]) {
  console.log(chalk.bold(label));
  for (const repo of repos) {
    const icon = repo.state === 'missing' ? chalk.yellow('!') : repo.state === 'error' ? chalk.red('✗') : chalk.green('✓');
    console.log(`${icon} ${repo.name}${repo.detail ? ` — ${repo.detail}` : ''}`);
  }
}

export async function syncCommand(opts: { pull?: boolean; interactive?: boolean; plain?: boolean; notify?: boolean; toCloud?: boolean }) {
  // Commander's `--no-pull` option surfaces as `opts.pull === false`, not `opts.noPull`
  // (there is no `noPull` property) -- `--no-pull` silently never worked before this fix.
  const noPull = opts.pull === false;
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  let indexed: number;
  let skipped: number;

  if (shouldUseInteractive(opts)) {
    const { pullResults, indexResults, result } = await runSyncWithProgress(process.cwd(), noPull);
    if (!noPull) {
      printRepoStatuses('Pulled repositories', pullResults);
      await runConfiguredHook(config, 'postPull');
    }
    printRepoStatuses('Re-indexed repositories', indexResults);
    console.log(`${chalk.green('✓')} indexed ${result.indexed} changed file(s), skipped ${result.skipped}`);
    indexed = result.indexed;
    skipped = result.skipped;
  } else {
    if (!noPull) {
      for (const repo of config.repositories) {
        const spinner = ora(`Pulling ${repo.name}`).start();
        try {
          await pullRepo(path.resolve(workspaceRoot, repo.path));
          spinner.succeed(`Pulled ${repo.name}`);
        } catch (error) {
          spinner.warn(`Could not pull ${repo.name}: ${(error as Error).message}`);
        }
      }

      await runConfiguredHook(config, 'postPull');
    }

    const spinner = ora('Re-indexing changed knowledge').start();
    const result = await indexWorkspace(workspaceRoot, false, updateSpinnerOnProgress(spinner, 'Re-indexing changed knowledge'));
    spinner.succeed('Workspace synced');
    console.log(`${chalk.green('✓')} indexed ${result.indexed} changed file(s), skipped ${result.skipped}`);
    indexed = result.indexed;
    skipped = result.skipped;
  }

  if (opts.notify) {
    notify('ctxhub sync', `Synced: indexed ${indexed} changed file(s), skipped ${skipped}.`);
  }

  await runConfiguredHook(config, 'postIndex');

  // Cloud sync: push newly promoted chunks if --to-cloud is set
  if (opts.toCloud) {
    const cloudConfig = await getSyncConfig();
    if (!cloudConfig) {
      console.log(chalk.gray('Cloud sync: not configured (set CTXHUB_CLOUD_ENDPOINT to enable)'));
    } else {
      const spinner = ora('Syncing promoted chunks to ctxhub Cloud').start();
      try {
        // Load all indexed documents to find institutional/canonical chunks
        const { createIndexProvider } = await import('../indexing/providers.js');
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
        const allChunks = await index.search('', 10_000);
        const result = await syncToCloud(cloudConfig, allChunks);
        if (result.skipped) {
          spinner.info(`Cloud sync: ${result.reason ?? 'skipped'}`);
        } else {
          spinner.succeed(`Synced ${result.synced ?? 0} chunk(s) to ctxhub Cloud`);
          if (result.failed && result.failed > 0) {
            console.log(chalk.yellow(`  ${result.failed} chunk(s) failed: ${(result.errors ?? []).join(', ')}`));
          }
          // Update last sync timestamp in cloud config
          try {
            const { loadCloudConfig, saveCloudConfig } = await import('./cloud.js');
            const cloudCfg = await loadCloudConfig();
            if (cloudCfg) {
              cloudCfg.lastSyncAt = new Date().toISOString();
              cloudCfg.chunksSynced = (cloudCfg.chunksSynced ?? 0) + (result.synced ?? 0);
              await saveCloudConfig(cloudCfg);
            }
          } catch {
            // best-effort
          }
        }
      } catch (error) {
        spinner.fail(`Cloud sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
