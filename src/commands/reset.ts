import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { getCtxhubHome } from '../workspaces/registry.js';
import { loadWorkspaceConfig } from '../config/config.js';

export async function resetCommand(opts: {
  registry?: boolean;
  global?: boolean;
  local?: boolean;
  all?: boolean;
  force?: boolean;
}) {
  const doRegistry = opts.all || opts.global || opts.registry || (!opts.local && !opts.global && !opts.all);
  const doGlobal   = opts.all || opts.global;
  const doLocal    = opts.all || opts.local;

  const home = getCtxhubHome();

  let localRoot: string | null = null;
  if (doLocal) {
    try {
      const { workspaceRoot } = await loadWorkspaceConfig(process.cwd());
      localRoot = path.join(workspaceRoot, '.ctxhub');
    } catch {
      // Not inside a ctxhub workspace
    }
  }

  const targets: string[] = [];
  if (doGlobal) {
    targets.push(`  ${chalk.yellow('~/.ctxhub/')}  registry, service logs, captain history`);
  } else if (doRegistry) {
    targets.push(`  ${chalk.yellow('~/.ctxhub/registry.json')}  all registered workspaces`);
  }
  if (doLocal) {
    if (localRoot) {
      targets.push(`  ${chalk.yellow(localRoot)}  index, cache, memory, config`);
    } else {
      console.log(chalk.yellow('--local: not inside a ctxhub workspace, nothing to clear locally.'));
      if (!doGlobal && !doRegistry) return;
    }
  }

  if (!targets.length) {
    console.log(chalk.yellow('Nothing to reset.'));
    return;
  }

  console.log('');
  console.log(chalk.red.bold('  WARNING — this will permanently delete:'));
  console.log('');
  for (const t of targets) console.log(t);
  console.log('');

  if (!opts.force) {
    const ok = await confirm({ message: 'Continue?', default: false }).catch(() => false);
    if (!ok) {
      console.log(chalk.gray('Aborted.'));
      return;
    }
  }

  let removed = 0;
  console.log('');

  if (doGlobal) {
    if (existsSync(home)) {
      await rm(home, { recursive: true, force: true });
      console.log(chalk.green('✓') + ` Removed ${home}`);
      removed++;
    } else {
      console.log(chalk.gray(`  ~/.ctxhub/ does not exist — nothing to remove.`));
    }
  } else if (doRegistry) {
    const registryPath = path.join(home, 'registry.json');
    if (existsSync(registryPath)) {
      await rm(registryPath, { force: true });
      console.log(chalk.green('✓') + ` Cleared registry`);
      removed++;
    } else {
      console.log(chalk.gray(`  Registry does not exist — nothing to remove.`));
    }
  }

  if (doLocal && localRoot) {
    if (existsSync(localRoot)) {
      await rm(localRoot, { recursive: true, force: true });
      console.log(chalk.green('✓') + ` Removed ${localRoot}`);
      removed++;
    } else {
      console.log(chalk.gray(`  ${localRoot} does not exist — nothing to remove.`));
    }
  }

  if (removed === 0) {
    console.log(chalk.yellow('Nothing was found to remove.'));
    return;
  }

  console.log('');
  console.log(chalk.bold('Reset complete.') + '  To start again:');
  console.log('');
  if (doLocal || doGlobal) {
    console.log(`  ${chalk.cyan('ctxhub workspace register .')}   re-register this workspace`);
    console.log(`  ${chalk.cyan('ctxhub repo add <name> .')}      add your repo(s)`);
    console.log(`  ${chalk.cyan('ctxhub index')}                   rebuild the index`);
  } else {
    console.log(`  ${chalk.cyan('ctxhub workspace register .')}   re-register workspaces`);
  }
  console.log('');
}
