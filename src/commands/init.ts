import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import { CONFIG_PATH, LOCAL_CONFIG_PATH, findConfigPath, initConfig } from '../config/config.js';
import { pathExists } from '../utils/fs.js';

export async function initCommand(opts: { name?: string; force?: boolean }) {
  const existingConfig = await findConfigPath();
  if (existingConfig && !opts.force) {
    throw new Error(`${existingConfig} already exists. Use --force to overwrite.`);
  }

  const name = opts.name ?? await input({ message: 'Workspace name', default: 'ssd-workspace' });
  await initConfig(name);
  const preferredPath = (await pathExists(LOCAL_CONFIG_PATH)) ? LOCAL_CONFIG_PATH : CONFIG_PATH;
  console.log(chalk.green(`Created ${preferredPath}`));
  console.log(chalk.gray('Created .ssd/index, .ssd/cache, and .ssd/memory'));
}
