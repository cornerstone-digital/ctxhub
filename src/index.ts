#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { repoAddCommand, repoDiscoverCommand, repoListCommand } from './commands/repo.js';
import { indexCommand } from './commands/index.js';
import { searchCommand } from './commands/search.js';
import { syncCommand } from './commands/sync.js';
import { memoryClearCommand, memoryStatusCommand } from './commands/memory.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('ssd')
  .description('SSD developer workspace CLI')
  .version('0.1.0');

program
  .command('init')
  .description('Initialise an SSD workspace')
  .option('-n, --name <name>', 'Workspace name')
  .option('-f, --force', 'Overwrite existing config')
  .action(initCommand);

const repo = program.command('repo').description('Manage workspace repositories');

repo
  .command('add')
  .argument('<name>', 'Repository name')
  .argument('<path>', 'Repository path')
  .description('Add a repository to the workspace')
  .action(repoAddCommand);

repo
  .command('list')
  .description('List configured repositories')
  .action(repoListCommand);

repo
  .command('discover')
  .argument('[root]', 'Root folder to scan', '.')
  .description('Discover Git repositories under a folder')
  .action(repoDiscoverCommand);

program
  .command('index')
  .description('Index changed workspace knowledge')
  .option('-f, --force', 'Force re-index all files')
  .action(indexCommand);

program
  .command('sync')
  .description('Pull repos and re-index changed knowledge')
  .option('--no-pull', 'Skip git pull')
  .action(syncCommand);

program
  .command('search')
  .argument('<query>', 'Search query')
  .option('-l, --limit <limit>', 'Max results', '5')
  .description('Search indexed workspace knowledge')
  .action(searchCommand);

const memory = program.command('memory').description('Manage memory/index store');

memory
  .command('status')
  .description('Show memory stats')
  .action(memoryStatusCommand);

memory
  .command('clear')
  .description('Clear local memory chunks')
  .option('-f, --force', 'Clear without confirmation')
  .action(memoryClearCommand);

program
  .command('doctor')
  .description('Check workspace health')
  .action(doctorCommand);

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError && (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')) {
    process.exit(0);
  }

  console.error(chalk.red((error as Error).message));
  process.exit(1);
}
