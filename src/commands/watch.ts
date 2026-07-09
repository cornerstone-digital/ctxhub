import chalk from 'chalk';
import { indexWorkspace } from '../indexing/indexer.js';

export async function watchCommand(opts: { interval?: string } = {}) {
  const intervalMs = Number(opts.interval ?? 30) * 1000;
  console.log(chalk.green(`Watching workspace; indexing every ${intervalMs / 1000}s. Press Ctrl+C to stop.`));

  async function run() {
    const result = await indexWorkspace();
    const changed = result.indexed + result.deleted;
    if (changed) console.log(`${new Date().toISOString()} indexed=${result.indexed} deleted=${result.deleted} skipped=${result.skipped}`);
  }

  await run();
  setInterval(() => void run().catch(error => console.error(chalk.red((error as Error).message))), intervalMs);
}
