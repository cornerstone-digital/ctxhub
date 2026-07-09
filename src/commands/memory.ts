import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../config/config.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { createIndexProvider } from '../indexing/providers.js';
import { saveManifest } from '../indexing/manifest.js';

export async function memoryStatusCommand() {
  const config = await loadConfig();
  const memory = createMemoryAdapter(config.memory.provider, config.memory.path);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const status = await memory.status();
  const indexStatus = await index.status();

  console.log(chalk.bold('Memory'));
  console.log(`${chalk.bold('Provider:')} ${status.provider}`);
  console.log(`${chalk.bold('Documents:')} ${status.documentCount}`);
  console.log(`${chalk.bold('Path:')} ${status.indexLocation}`);
  console.log(`${chalk.bold('Last updated:')} ${status.lastIndexed ?? 'never'}`);

  console.log(`\n${chalk.bold('Index')}`);
  console.log(`${chalk.bold('Provider:')} ${indexStatus.provider}`);
  console.log(`${chalk.bold('Chunks:')} ${indexStatus.chunkCount}`);
  console.log(`${chalk.bold('Path:')} ${indexStatus.indexLocation}`);
  console.log(`${chalk.bold('Last indexed:')} ${indexStatus.lastIndexed ?? 'never'}`);
}

export async function memoryClearCommand(opts: { force?: boolean } = {}) {
  const config = await loadConfig();
  const shouldClear = opts.force || await confirm({ message: 'Clear local ctxhub memory and index?', default: false });
  if (!shouldClear) {
    console.log(chalk.yellow('Memory clear cancelled.'));
    return;
  }

  const memory = createMemoryAdapter(config.memory.provider, config.memory.path);
  await memory.clear();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  await index.clear();
  // The manifest tracks per-file hashes independently of the index; without resetting it too,
  // `ctxhub index` would see every file as "unchanged" and skip re-indexing them into the now-empty index.
  await saveManifest({ version: 1, workspace: config.workspace.name, files: {} });
  console.log(chalk.green('Memory cleared.'));
}
