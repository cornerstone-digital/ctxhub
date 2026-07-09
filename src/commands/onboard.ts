import chalk from 'chalk';
import { checkbox, confirm, input } from '@inquirer/prompts';
import { execa } from '../utils/execa-lite.js';
import { findConfigPath, loadConfig } from '../config/config.js';
import { isMempalaceAvailable } from '../memory/LocalJsonMemory.js';
import { initCommand } from './init.js';
import { repoDiscoverCommand, repoHookCommand } from './repo.js';
import { indexCommand } from './index.js';
import { agentLaunchCommand, SUPPORTED_AGENTS } from './agent.js';
import { skillsInstallCommand, SUPPORTED_SKILL_AGENTS } from './skills.js';

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execa(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function onboardCommand() {
  console.log(chalk.bold('ctxhub onboard') + chalk.gray(' — set up this workspace step by step\n'));

  const existingConfigPath = await findConfigPath();
  if (existingConfigPath) {
    console.log(chalk.gray(`Using existing config: ${existingConfigPath}`));
  } else {
    const name = await input({ message: 'Workspace name', default: 'ctxhub-workspace' });
    await initCommand({ name });
  }

  let config = await loadConfig();

  if (!config.repositories.length) {
    const shouldDiscover = await confirm({
      message: 'Discover Git repos under the current directory and add them?',
      default: true
    });
    if (shouldDiscover) {
      await repoDiscoverCommand('.');
      config = await loadConfig();
    }
  }

  if (config.repositories.length) {
    const wantHooks = await confirm({
      message: 'Auto-reindex on every commit? (installs a git post-commit hook per repo)',
      default: false
    });
    if (wantHooks) {
      for (const repo of config.repositories) {
        try {
          await repoHookCommand(repo.name);
        } catch (error) {
          console.log(chalk.yellow(`Skipped hook for ${repo.name}: ${(error as Error).message}`));
        }
      }
    }
  }

  if (config.memory.provider === 'mempalace' && !(await isMempalaceAvailable())) {
    const wantInstall = await confirm({
      message: 'MemPalace CLI not found (used for durable agent memory). Install it now via `uv tool install mempalace`?',
      default: false
    });
    if (wantInstall) {
      if (await isCommandAvailable('uv')) {
        console.log(chalk.gray('Running: uv tool install mempalace'));
        try {
          await execa('uv', ['tool', 'install', 'mempalace']);
          console.log(chalk.green('MemPalace installed.'));
        } catch (error) {
          console.log(chalk.yellow(`Install failed: ${(error as Error).message}`));
        }
      } else {
        console.log(chalk.yellow('uv not found on PATH. Install uv first (https://docs.astral.sh/uv/), then run: uv tool install mempalace'));
      }
    }
  }

  const agents = await checkbox<string>({
    message: 'Which coding agents do you use? (installs MCP config + a usage skill for each)',
    choices: SUPPORTED_SKILL_AGENTS.map(agent => ({ name: agent, value: agent }))
  });

  if (agents.length) {
    await skillsInstallCommand(agents);

    for (const agent of agents) {
      if ((SUPPORTED_AGENTS as readonly string[]).includes(agent)) {
        await agentLaunchCommand(agent, { launch: false });
      }
    }
  }

  if (config.repositories.length) {
    const wantIndex = await confirm({ message: 'Run an initial index now?', default: true });
    if (wantIndex) {
      await indexCommand({});
    }
  }

  console.log(chalk.bold.green('\nOnboarding complete.') + chalk.gray(' Run `ctxhub doctor` any time to check workspace health.'));
}
