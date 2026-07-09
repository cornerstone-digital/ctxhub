import chalk from 'chalk';
import path from 'node:path';
import { loadConfig, findConfigPath, INDEX_DIR, relativeConfigPath } from '../config/config.js';
import { ensureDir, pathExists } from '../utils/fs.js';
import { getCurrentCommit, isGitInstalled, isGitRepo } from '../git/git.js';
import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';

export async function doctorCommand() {
  const configPath = await findConfigPath();
  if (!configPath) {
    console.log(`${chalk.red('✗')} No config found. Run: devctx init`);
    return;
  }

  const config = await loadConfig();
  console.log(`${chalk.green('✓')} Node ${process.version}`);
  console.log((await isGitInstalled()) ? `${chalk.green('✓')} Git installed` : `${chalk.red('✗')} Git is not installed`);
  console.log(`${chalk.green('✓')} devctx config loaded: ${config.workspace.name} (${relativeConfigPath(configPath)})`);

  try {
    await ensureDir(path.join(process.cwd(), INDEX_DIR));
    console.log(`${chalk.green('✓')} Index directory writable`);
  } catch (error) {
    console.log(`${chalk.red('✗')} Index directory not writable: ${(error as Error).message}`);
  }

  try {
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
    await index.status();
    console.log(`${chalk.green('✓')} Index provider available: ${config.index.provider}`);
  } catch (error) {
    console.log(`${chalk.red('✗')} Index provider unavailable: ${(error as Error).message}`);
  }

  try {
    const memory = createMemoryAdapter(config.memory.provider, config.memory.path);
    await memory.status();
    console.log(`${chalk.green('✓')} Memory provider available: ${config.memory.provider}`);
  } catch (error) {
    console.log(`${chalk.yellow('!')} Memory provider needs setup: ${(error as Error).message}`);
  }

  for (const repo of config.repositories) {
    const exists = await pathExists(repo.path);
    if (!exists) {
      console.log(`${chalk.red('✗')} ${repo.name}: path missing ${repo.path}`);
      continue;
    }

    const git = await isGitRepo(repo.path);
    const commit = git ? await getCurrentCommit(repo.path) : undefined;
    console.log(git
      ? `${chalk.green('✓')} ${repo.name}: ${commit?.slice(0, 7) ?? 'no commit'}`
      : `${chalk.yellow('!')} ${repo.name}: path exists, not a git repo`);
  }
}
