import { createInterface } from 'node:readline';
import { rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { getCtxhubHome } from '../workspaces/registry.js';
import { loadWorkspaceConfig } from '../config/config.js';

// What each scope clears:
//
//   --registry   ~/.ctxhub/registry.json — unregisters all workspaces from the control plane.
//                The workspace directories themselves are untouched.
//
//   --global     Everything in ~/.ctxhub/ — registry, service PID/logs, captain task definitions
//                and their run history. Does NOT touch workspace-local data.
//
//   --local      .ctxhub/ in the current workspace root — index, cache, memory, config. Leaves
//                the global registry entry in place (the path is still registered, just emptied).
//
//   --all        --global + --local combined: full clean slate.
//
// Default (no flags): --registry only (the most common "start fresh" case).

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

  // Resolve local workspace root (best-effort — may not exist)
  let localRoot: string | null = null;
  if (doLocal) {
    try {
      const { workspaceRoot } = await loadWorkspaceConfig(process.cwd());
      localRoot = path.join(workspaceRoot, '.ctxhub');
    } catch {
      // Not inside a ctxhub workspace
    }
  }

  // Build a summary of what will be deleted
  const targets: string[] = [];
  if (doGlobal) {
    targets.push(`  ${chalk.yellow('~/.ctxhub/')} (registry, service logs, captain history)`);
  } else if (doRegistry) {
    targets.push(`  ${chalk.yellow('~/.ctxhub/registry.json')} (registered workspaces)`);
  }
  if (doLocal) {
    if (localRoot) {
      targets.push(`  ${chalk.yellow(localRoot)} (index, cache, memory, config)`);
    } else {
      console.log(chalk.yellow('--local: not inside a ctxhub workspace, nothing to clear locally.'));
      if (!doGlobal && !doRegistry) return;
    }
  }

  if (!targets.length) {
    console.log(chalk.yellow('Nothing to reset.'));
    return;
  }

  console.log(chalk.bold('The following will be permanently deleted:'));
  for (const t of targets) console.log(t);

  if (!opts.force) {
    const confirmed = await confirm('Continue? [y/N] ');
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  let removed = 0;

  if (doGlobal) {
    if (existsSync(home)) {
      await rm(home, { recursive: true, force: true });
      console.log(chalk.green(`✓ Removed ${home}`));
      removed++;
    } else {
      console.log(chalk.gray(`  ~/.ctxhub/ does not exist — nothing to remove.`));
    }
  } else if (doRegistry) {
    const registryPath = path.join(home, 'registry.json');
    if (existsSync(registryPath)) {
      await rm(registryPath, { force: true });
      console.log(chalk.green(`✓ Cleared registry (${registryPath})`));
      removed++;
    } else {
      console.log(chalk.gray(`  Registry does not exist — nothing to remove.`));
    }
  }

  if (doLocal && localRoot) {
    if (existsSync(localRoot)) {
      await rm(localRoot, { recursive: true, force: true });
      console.log(chalk.green(`✓ Removed ${localRoot}`));
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
  console.log(chalk.bold('Reset complete.') + ' To set up again:');
  if (doLocal || doGlobal) {
    console.log(`  ${chalk.cyan('ctxhub workspace register .')}  — re-register this workspace`);
    console.log(`  ${chalk.cyan('ctxhub repo add <name> .')}     — add your repo(s)`);
    console.log(`  ${chalk.cyan('ctxhub index')}                  — rebuild the index`);
  } else {
    console.log(`  ${chalk.cyan('ctxhub workspace register .')}  — re-register workspaces`);
  }
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
