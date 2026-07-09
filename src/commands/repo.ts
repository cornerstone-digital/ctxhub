import path from 'node:path';
import { chmod } from 'node:fs/promises';
import chalk from 'chalk';
import fg from 'fast-glob';
import { loadConfig, saveConfig } from '../config/config.js';
import { getRepoName, isGitRepo } from '../git/git.js';
import { pathExists, writeText } from '../utils/fs.js';

export async function repoAddCommand(name: string, repoPath: string) {
  const config = await loadConfig();
  if (config.repositories.some(r => r.name === name)) {
    throw new Error(`Repository already exists: ${name}`);
  }

  const absolutePath = path.resolve(process.cwd(), repoPath);
  if (!(await pathExists(absolutePath))) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  const git = await isGitRepo(absolutePath);
  config.repositories.push({ name, path: repoPath, git });
  await saveConfig(config);
  console.log(chalk.green(`Added repo ${name} -> ${repoPath}`));
  console.log(git ? chalk.gray('Git repository detected') : chalk.yellow('Path added, but it is not a Git repository'));
}

export async function repoListCommand() {
  const config = await loadConfig();
  if (!config.repositories.length) {
    console.log(chalk.yellow('No repositories configured.'));
    return;
  }

  for (const repo of config.repositories) {
    const gitLabel = repo.git === false ? chalk.yellow('non-git') : chalk.gray('git');
    console.log(`${chalk.green('✓')} ${repo.name} ${chalk.gray(repo.path)} ${gitLabel}`);
  }
}

export async function repoDiscoverCommand(root = '.') {
  const config = await loadConfig();
  const gitDirs = await fg('**/.git', { cwd: root, onlyDirectories: true, ignore: ['**/node_modules/**', '**/dist/**'] });
  let added = 0;
  let skipped = 0;

  for (const gitDir of gitDirs) {
    const repoPath = path.dirname(path.join(root, gitDir));
    const name = getRepoName(repoPath);
    if (!config.repositories.some(r => r.path === repoPath || r.name === name)) {
      config.repositories.push({ name, path: repoPath, git: true });
      console.log(chalk.green(`Discovered ${name} -> ${repoPath}`));
      added += 1;
    } else {
      skipped += 1;
    }
  }

  await saveConfig(config);
  if (!gitDirs.length) {
    console.log(chalk.yellow(`No Git repositories found under ${root}.`));
    return;
  }

  if (!added) {
    console.log(chalk.gray(`No new repositories added (${skipped} already configured).`));
    return;
  }

  console.log(chalk.green(`Added ${added} repositor${added === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} already configured` : ''}.`));
  console.log(chalk.gray('Next: run ctxhub index to add their knowledge to the workspace.'));
}

export function postCommitHookScript(workspaceRoot: string, cliEntryPath: string, repoName: string): string {
  return [
    '#!/bin/sh',
    `# Installed by ctxhub (\`ctxhub repo hook ${repoName}\`) — re-indexes this ctxhub workspace after each commit.`,
    `cd "${workspaceRoot}" || exit 0`,
    `node "${cliEntryPath}" index >/dev/null 2>&1 &`,
    'exit 0',
    ''
  ].join('\n');
}

export async function repoHookCommand(name: string, opts: { force?: boolean } = {}) {
  const config = await loadConfig();
  const repo = config.repositories.find(r => r.name === name);
  if (!repo) {
    throw new Error(`Repository not found: ${name}`);
  }

  const repoAbsolutePath = path.resolve(process.cwd(), repo.path);
  if (!(await isGitRepo(repoAbsolutePath))) {
    throw new Error(`${name} is not a Git repository: ${repo.path}`);
  }

  const hookPath = path.join(repoAbsolutePath, '.git', 'hooks', 'post-commit');
  if (!opts.force && (await pathExists(hookPath))) {
    throw new Error(`${hookPath} already exists. Use --force to overwrite.`);
  }

  const script = postCommitHookScript(process.cwd(), process.argv[1], name);
  await writeText(hookPath, script);
  await chmod(hookPath, 0o755);

  console.log(chalk.green(`Installed post-commit hook for ${name}`));
  console.log(chalk.gray(hookPath));
}
