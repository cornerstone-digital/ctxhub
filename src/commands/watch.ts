import chalk from 'chalk';
import { indexWorkspace } from '../indexing/indexer.js';
import { runWatchWithProgress } from '../tui/progress/WatchProgressApp.js';
import { formatFileProgress } from '../tui/progress/applyIndexProgress.js';

export async function watchCommand(opts: { interval?: string } = {}) {
  const intervalMs = Number(opts.interval ?? 30) * 1000;

  if (process.stdout.isTTY) {
    await runWatchWithProgress(process.cwd(), intervalMs);
    return;
  }

  console.log(chalk.green(`Watching workspace; indexing every ${intervalMs / 1000}s. Press Ctrl+C to stop.`));

  async function run() {
    const result = await indexWorkspace(process.cwd(), false, event => {
      // Only the (potentially long-running) file-count progress is worth a log line here;
      // repo-start/repo-missing are one-liners and repo-done is covered by the summary below.
      if (event.type === 'repo-progress' && event.total > 0) {
        console.log(`${new Date().toISOString()} ${event.repo}: ${formatFileProgress(event.scanned, event.total)}`);
      }
    });
    const changed = result.indexed + result.deleted;
    if (changed) console.log(`${new Date().toISOString()} indexed=${result.indexed} deleted=${result.deleted} skipped=${result.skipped}`);
  }

  await run();
  setInterval(() => void run().catch(error => console.error(chalk.red((error as Error).message))), intervalMs);
}
