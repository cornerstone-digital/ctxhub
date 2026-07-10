import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { loadWorkspaceConfig } from '../config/config.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { createIndexProvider } from '../indexing/providers.js';
import { saveManifest } from '../indexing/manifest.js';
import { readMempalaceStatusSummary, searchMempalace, timelineMempalace } from '../memory/mempalaceCli.js';
import { runMemoryStatusApp } from '../tui/MemoryStatusApp.js';
import { shouldUseInteractive } from '../utils/interactive.js';

export async function memoryStatusCommand(
  opts: { interactive?: boolean; plain?: boolean } = {},
  deps: { readMempalaceStatusSummaryFn?: typeof readMempalaceStatusSummary } = {}
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const memory = createMemoryAdapter(config.memory.provider, config.memory.path, workspaceRoot);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const status = await memory.status();
  const indexStatus = await index.status();
  const memorySummary = await (deps.readMempalaceStatusSummaryFn ?? readMempalaceStatusSummary)(config, workspaceRoot);

  if (shouldUseInteractive(opts)) {
    await runMemoryStatusApp(status, indexStatus);
    return;
  }

  console.log(chalk.bold('Memory'));
  console.log(`${chalk.bold('Provider:')} ${status.provider}`);
  console.log(`${chalk.bold('Documents:')} ${status.documentCount}`);
  console.log(`${chalk.bold('Path:')} ${status.indexLocation}`);
  console.log(`${chalk.bold('Last updated:')} ${status.lastIndexed ?? 'never'}`);
  if (memorySummary.note) console.log(`${chalk.bold('MemPalace:')} ${memorySummary.note}`);
  if (memorySummary.items.length) {
    console.log(`\n${chalk.bold('Wings & Rooms')}`);
    for (const item of memorySummary.items) {
      console.log(`- ${item.wing} / ${item.room} (${item.count} drawer${item.count === 1 ? '' : 's'})`);
    }
  }

  console.log(`\n${chalk.bold('Index')}`);
  console.log(`${chalk.bold('Provider:')} ${indexStatus.provider}`);
  console.log(`${chalk.bold('Chunks:')} ${indexStatus.chunkCount}`);
  console.log(`${chalk.bold('Path:')} ${indexStatus.indexLocation}`);
  console.log(`${chalk.bold('Last indexed:')} ${indexStatus.lastIndexed ?? 'never'}`);
}

export async function memorySearchCommand(
  query: string,
  opts: { wing?: string; room?: string; sourceFile?: string; limit?: string; json?: boolean } = {},
  deps: { searchMempalaceFn?: typeof searchMempalace } = {}
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const result = await (deps.searchMempalaceFn ?? searchMempalace)(config, workspaceRoot, {
    query,
    wing: opts.wing,
    room: opts.room,
    sourceFile: opts.sourceFile,
    limit: Number(opts.limit ?? 5)
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.error) {
    console.log(chalk.yellow(result.error));
    if (result.hint) console.log(chalk.gray(result.hint));
    return;
  }

  console.log(chalk.bold(`MemPalace search: ${query}`));
  if (opts.wing) console.log(chalk.gray(`Wing: ${opts.wing}`));
  if (opts.room) console.log(chalk.gray(`Room: ${opts.room}`));
  if (!result.results.length) {
    console.log(chalk.yellow('No memory results found.'));
    return;
  }

  for (const [index, hit] of result.results.entries()) {
    console.log(`\n${chalk.green(`[${index + 1}]`)} ${hit.wing} / ${hit.room}`);
    if (hit.source_file) console.log(chalk.gray(`Source: ${hit.source_file}`));
    if (hit.similarity !== undefined) console.log(chalk.gray(`Similarity: ${hit.similarity}`));
    console.log(hit.text);
  }
}

export async function memoryTimelineCommand(
  entity: string | undefined,
  opts: { json?: boolean } = {},
  deps: { timelineMempalaceFn?: typeof timelineMempalace } = {}
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const result = await (deps.timelineMempalaceFn ?? timelineMempalace)(config, workspaceRoot, { entity });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.error) {
    console.log(chalk.yellow(result.error));
    return;
  }

  console.log(chalk.bold(`MemPalace timeline: ${result.entity ?? entity ?? 'all'}`));
  console.log(chalk.gray(`${result.count ?? 0} event(s)`));
  for (const item of result.timeline ?? []) {
    console.log(`\n${JSON.stringify(item, null, 2)}`);
  }
}

export async function memoryClearCommand(opts: { force?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const shouldClear = opts.force || await confirm({ message: 'Clear local ctxhub memory and index?', default: false });
  if (!shouldClear) {
    console.log(chalk.yellow('Memory clear cancelled.'));
    return;
  }

  const memory = createMemoryAdapter(config.memory.provider, config.memory.path, workspaceRoot);
  await memory.clear();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  await index.clear();
  // The manifest tracks per-file hashes independently of the index; without resetting it too,
  // `ctxhub index` would see every file as "unchanged" and skip re-indexing them into the now-empty index.
  await saveManifest({ version: 1, workspace: config.workspace.name, files: {} }, workspaceRoot);
  console.log(chalk.green('Memory cleared.'));
}
