import { spawn } from 'node:child_process';
import chalk from 'chalk';
import type { DevctxConfig } from '../config/types.js';

export type HookName = 'postPull' | 'postIndex';

function runShellCommand(command: string, cwd: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...env }
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Hook command failed with code ${code}: ${command}`));
    });
  });
}

export async function runConfiguredHook(config: DevctxConfig, hook: HookName, cwd = process.cwd()): Promise<void> {
  const command = config.hooks[hook];
  if (!command) return;

  console.log(chalk.gray(`\n> Running ${hook} hook: ${command}`));
  try {
    await runShellCommand(command, cwd, { DEVCTX_EVENT: hook, DEVCTX_WORKSPACE: config.workspace.name });
  } catch (error) {
    console.log(chalk.yellow(`Hook ${hook} failed: ${(error as Error).message}`));
  }
}
