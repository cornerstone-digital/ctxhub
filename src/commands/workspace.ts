import path from 'node:path';
import chalk from 'chalk';
import { listWorkspaces, registerWorkspace, removeWorkspace } from '../workspaces/registry.js';

export async function workspaceRegisterCommand(targetPath = '.', opts: { name?: string } = {}) {
  const absolutePath = path.resolve(process.cwd(), targetPath);
  const entry = await registerWorkspace(absolutePath, opts.name);
  console.log(chalk.green(`Registered workspace "${entry.name}": ${entry.path}`));
}

export async function workspaceListCommand() {
  const workspaces = await listWorkspaces();
  if (!workspaces.length) {
    console.log(chalk.yellow('No workspaces registered. Run: ctxhub workspace register [path]'));
    return;
  }

  console.log(chalk.bold('Registered workspaces') + chalk.gray(' (~/.ctxhub/registry.json)'));
  console.log('');

  for (const workspace of workspaces) {
    const marker = workspace.exists ? chalk.green('✓') : chalk.red('✗');
    const segments = workspace.path.split(path.sep);
    const shortPath = segments.slice(-3).join(path.sep);
    console.log(`${marker} ${workspace.name} ${chalk.gray(shortPath)}`);
    if (!workspace.exists) {
      console.log(`    ${chalk.red('(path missing)')} ${chalk.gray(workspace.path)}`);
    }
  }
}

export async function workspaceRemoveCommand(name: string) {
  const removed = await removeWorkspace(name);
  if (!removed) {
    console.log(chalk.yellow(`No registered workspace named "${name}".`));
    return;
  }

  console.log(chalk.green(`Removed workspace "${name}" from the registry.`));
}
