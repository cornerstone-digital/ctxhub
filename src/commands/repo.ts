import path from 'node:path';
import chalk from 'chalk';
import fg from 'fast-glob';
import { loadConfig, saveConfig } from '../config/config.js';
import { getRepoName, isGitRepo } from '../git/git.js';
import { pathExists } from '../utils/fs.js';

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

  for (const gitDir of gitDirs) {
    const repoPath = path.dirname(path.join(root, gitDir));
    const name = getRepoName(repoPath);
    if (!config.repositories.some(r => r.path === repoPath || r.name === name)) {
      config.repositories.push({ name, path: repoPath, git: true });
      console.log(chalk.green(`Discovered ${name} -> ${repoPath}`));
    }
  }

  await saveConfig(config);
}
