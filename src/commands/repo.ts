import path from 'node:path';
import { chmod } from 'node:fs/promises';
import chalk from 'chalk';
import fg from 'fast-glob';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { getRepoName, isGitRepo } from '../git/git.js';
import { pathExists, writeText } from '../utils/fs.js';
import { runRepoDiscoverReview } from '../tui/RepoDiscoverApp.js';
import { shouldUseInteractive } from '../utils/interactive.js';

export type DiscoveredRepo = {
  name: string;
  path: string;
  state: 'new' | 'configured';
};

export async function repoAddCommand(name: string, repoPath: string) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  if (config.repositories.some(r => r.name === name)) {
    throw new Error(`Repository already exists: ${name}`);
  }

  const absolutePath = path.resolve(process.cwd(), repoPath);
  if (!(await pathExists(absolutePath))) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  const git = await isGitRepo(absolutePath);
  const configPath = path.relative(workspaceRoot, absolutePath) || '.';
  config.repositories.push({ name, path: configPath, git });
  await saveConfig(config);
  console.log(chalk.green(`Added repo ${name} -> ${configPath}`));
  console.log(git ? chalk.gray('Git repository detected') : chalk.yellow('Path added, but it is not a Git repository'));
}

export async function repoListCommand() {
  const { config } = await loadWorkspaceConfig();
  if (!config.repositories.length) {
    console.log(chalk.yellow('No repositories configured.'));
    return;
  }

  for (const repo of config.repositories) {
    const gitLabel = repo.git === false ? chalk.yellow('non-git') : chalk.gray('git');
    console.log(`${chalk.green('✓')} ${repo.name} ${chalk.gray(repo.path)} ${gitLabel}`);
  }
}

export async function repoDiscoverCommand(root = '.', opts: { interactive?: boolean; plain?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const discoveryRoot = path.resolve(process.cwd(), root);
  const discovered = await discoverRepositoriesFromRoot(discoveryRoot, config, workspaceRoot);
  const newRepos = discovered.filter(repo => repo.state === 'new');
  const skipped = discovered.length - newRepos.length;

  if (!discovered.length) {
    console.log(chalk.yellow(`No Git repositories found under ${root}.`));
    return;
  }

  const selected = shouldUseInteractive(opts) && newRepos.length
    ? await runRepoDiscoverReview(root, discovered)
    : newRepos;

  if (!selected) {
    console.log(chalk.yellow('Repository discovery cancelled.'));
    return;
  }

  for (const repo of selected) {
    config.repositories.push({ name: repo.name, path: repo.path, git: true });
    console.log(chalk.green(`Discovered ${repo.name} -> ${repo.path}`));
  }

  await saveConfig(config);
  if (!selected.length) {
    console.log(chalk.gray(`No new repositories added (${skipped} already configured).`));
    return;
  }

  console.log(chalk.green(`Added ${selected.length} repositor${selected.length === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} already configured` : ''}.`));
  console.log(chalk.gray('Next: run ctxhub index to add their knowledge to the workspace.'));
}

export async function discoverRepositories(root: string, config: CtxhubConfig): Promise<DiscoveredRepo[]> {
  return discoverRepositoriesFromRoot(root, config, root);
}

async function discoverRepositoriesFromRoot(root: string, config: CtxhubConfig, workspaceRoot: string): Promise<DiscoveredRepo[]> {
  const gitDirs = await fg('**/.git', { cwd: root, onlyDirectories: true, ignore: ['**/node_modules/**', '**/dist/**'] });
  return gitDirs.map(gitDir => {
    const absoluteRepoPath = path.dirname(path.join(root, gitDir));
    const repoPath = path.relative(workspaceRoot, absoluteRepoPath) || '.';
    const name = getRepoName(absoluteRepoPath);
    return {
      name,
      path: repoPath,
      state: config.repositories.some(r => r.path === repoPath || r.name === name) ? 'configured' : 'new'
    };
  });
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
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const repo = config.repositories.find(r => r.name === name);
  if (!repo) {
    throw new Error(`Repository not found: ${name}`);
  }

  const repoAbsolutePath = path.resolve(workspaceRoot, repo.path);
  if (!(await isGitRepo(repoAbsolutePath))) {
    throw new Error(`${name} is not a Git repository: ${repo.path}`);
  }

  const hookPath = path.join(repoAbsolutePath, '.git', 'hooks', 'post-commit');
  if (!opts.force && (await pathExists(hookPath))) {
    throw new Error(`${hookPath} already exists. Use --force to overwrite.`);
  }

  const script = postCommitHookScript(workspaceRoot, process.argv[1], name);
  await writeText(hookPath, script);
  await chmod(hookPath, 0o755);

  console.log(chalk.green(`Installed post-commit hook for ${name}`));
  console.log(chalk.gray(hookPath));
}
