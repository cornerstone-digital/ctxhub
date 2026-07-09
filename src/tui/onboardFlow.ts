import chalk from 'chalk';
import { findConfigPath, loadConfig } from '../config/config.js';
import { execa } from '../utils/execa-lite.js';
import { isMempalaceAvailable } from '../memory/LocalJsonMemory.js';
import { initCommand } from '../commands/init.js';
import { repoDiscoverCommand, repoHookCommand } from '../commands/repo.js';
import { indexCommand } from '../commands/index.js';
import { agentLaunchCommand, SUPPORTED_AGENTS } from '../commands/agent.js';
import { skillsInstallCommand, SUPPORTED_SKILL_AGENTS } from '../commands/skills.js';

export type OnboardDeps = {
  findConfigPath: typeof findConfigPath;
  loadConfig: typeof loadConfig;
  initCommand: typeof initCommand;
  repoDiscoverCommand: typeof repoDiscoverCommand;
  repoHookCommand: typeof repoHookCommand;
  isMempalaceAvailable: typeof isMempalaceAvailable;
  isCommandAvailable: (command: string) => Promise<boolean>;
  execa: typeof execa;
  skillsInstallCommand: typeof skillsInstallCommand;
  agentLaunchCommand: typeof agentLaunchCommand;
  indexCommand: typeof indexCommand;
};

async function defaultIsCommandAvailable(command: string): Promise<boolean> {
  try {
    await execa(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export const defaultOnboardDeps: OnboardDeps = {
  findConfigPath,
  loadConfig,
  initCommand,
  repoDiscoverCommand,
  repoHookCommand,
  isMempalaceAvailable,
  isCommandAvailable: defaultIsCommandAvailable,
  execa,
  skillsInstallCommand,
  agentLaunchCommand,
  indexCommand
};

// Bridges the linear onboarding flow to Ink: `suspendTerminal` hands the terminal to
// anything that writes directly (console.log/chalk, or -- for indexCommand's TTY path --
// a nested Ink instance of its own), while the ask* functions pause this flow until the
// user answers a rendered prompt. See OnboardApp.tsx for how these are wired to state.
export type OnboardIO = {
  suspendTerminal: (callback: () => void | Promise<void>) => Promise<void>;
  askText: (message: string, defaultValue: string) => Promise<string>;
  askConfirm: (message: string, defaultValue: boolean) => Promise<boolean>;
  askMultiSelect: (message: string, choices: string[]) => Promise<string[]>;
};

export async function runOnboardFlow(cwd: string, io: OnboardIO, deps: OnboardDeps = defaultOnboardDeps): Promise<void> {
  console.log(chalk.bold('ctxhub onboard') + chalk.gray(' — set up this workspace step by step\n'));

  const existingConfigPath = await deps.findConfigPath(cwd);
  if (existingConfigPath) {
    console.log(chalk.gray(`Using existing config: ${existingConfigPath}`));
  } else {
    const name = await io.askText('Workspace name', 'ctxhub-workspace');
    await io.suspendTerminal(() => deps.initCommand({ name }));
  }

  let config = await deps.loadConfig(cwd);

  if (!config.repositories.length) {
    const shouldDiscover = await io.askConfirm('Discover Git repos under the current directory and add them?', true);
    if (shouldDiscover) {
      await io.suspendTerminal(() => deps.repoDiscoverCommand('.'));
      config = await deps.loadConfig(cwd);
    }
  }

  if (config.repositories.length) {
    const wantHooks = await io.askConfirm('Auto-reindex on every commit? (installs a git post-commit hook per repo)', false);
    if (wantHooks) {
      await io.suspendTerminal(async () => {
        for (const repo of config.repositories) {
          try {
            await deps.repoHookCommand(repo.name);
          } catch (error) {
            console.log(chalk.yellow(`Skipped hook for ${repo.name}: ${(error as Error).message}`));
          }
        }
      });
    }
  }

  if (config.memory.provider === 'mempalace' && !(await deps.isMempalaceAvailable())) {
    const wantInstall = await io.askConfirm(
      'MemPalace CLI not found (used for durable agent memory). Install it now via `uv tool install mempalace`?',
      false
    );
    if (wantInstall) {
      if (await deps.isCommandAvailable('uv')) {
        console.log(chalk.gray('Running: uv tool install mempalace'));
        try {
          await deps.execa('uv', ['tool', 'install', 'mempalace']);
          console.log(chalk.green('MemPalace installed.'));
        } catch (error) {
          console.log(chalk.yellow(`Install failed: ${(error as Error).message}`));
        }
      } else {
        console.log(chalk.yellow('uv not found on PATH. Install uv first (https://docs.astral.sh/uv/), then run: uv tool install mempalace'));
      }
    }
  }

  const agents = await io.askMultiSelect(
    'Which coding agents do you use? (installs MCP config + a usage skill for each)',
    [...SUPPORTED_SKILL_AGENTS]
  );
  if (agents.length) {
    await io.suspendTerminal(async () => {
      await deps.skillsInstallCommand(agents);
      for (const agent of agents) {
        if ((SUPPORTED_AGENTS as readonly string[]).includes(agent)) {
          await deps.agentLaunchCommand(agent, { launch: false });
        }
      }
    });
  }

  if (config.repositories.length) {
    const wantIndex = await io.askConfirm('Run an initial index now?', true);
    if (wantIndex) {
      await io.suspendTerminal(() => deps.indexCommand({}));
    }
  }

  console.log(chalk.bold.green('\nOnboarding complete.') + chalk.gray(' Run `ctxhub doctor` any time to check workspace health.'));
}
