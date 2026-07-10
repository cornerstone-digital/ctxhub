#!/usr/bin/env node
import { CommanderError } from 'commander';
import chalk from 'chalk';
import { buildProgram } from './cli/program.js';
import { runGuidedMode } from './commands/guided.js';

const program = buildProgram();
program.exitOverride();

try {
  if (process.argv.length <= 2 && process.stdin.isTTY) {
    await runGuidedMode();
  } else {
    await program.parseAsync(process.argv);
  }
} catch (error) {
  if (error instanceof CommanderError && (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')) {
    process.exit(0);
  }

  console.error(chalk.red((error as Error).message));
  if (process.env.DEBUG || process.argv.includes('--debug')) {
    console.error(chalk.dim((error as Error).stack ?? ''));
  }
  process.exit(1);
}
