import chalk from 'chalk';
import { findConfigPath, loadConfig } from '../config/config.js';
import { execa } from '../utils/execa-lite.js';
import { isMempalaceAvailable } from '../memory/LocalJsonMemory.js';
import { initCommand } from '../commands/init.js';
import { repoDiscoverCommand, repoHookCommand } from '../commands/repo.js';
import { indexCommand } from '../commands/index.js';
import { agentLaunchCommand, SUPPORTED_AGENTS } from '../commands/agent.js';
import { skillsInstallCommand, SUPPORTED_SKILL_AGENTS } from '../commands/skills.js';
import { createContextPack } from '../context/pack.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import type { CtxhubConfig } from '../config/types.js';
import { isAuthConfigured as defaultIsAuthConfigured, initAuthConfig as defaultInitAuthConfig } from '../auth/config.js';
import { REDIRECT_URI } from '../auth/loginFlow.js';
import type { AuthConfig, OidcConfig } from '../auth/types.js';

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
  createContextPack: typeof createContextPack;
  runAgentPrompt: typeof runAgentPrompt;
  /** Optional: check if enterprise auth is configured. Defaults to the real implementation. */
  isAuthConfigured?: () => Promise<boolean>;
  /** Optional: initialise enterprise auth config. Defaults to the real implementation. */
  initAuthConfig?: (oidc: OidcConfig) => Promise<AuthConfig>;
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
  indexCommand,
  createContextPack,
  runAgentPrompt,
  isAuthConfigured: defaultIsAuthConfigured,
  initAuthConfig: defaultInitAuthConfig
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

  // ── Enterprise SSO step ──────────────────────────────────────────────────────
  const checkAuth = deps.isAuthConfigured ?? defaultIsAuthConfigured;
  const doInitAuth = deps.initAuthConfig ?? defaultInitAuthConfig;
  const authAlreadyConfigured = await checkAuth();
  if (!authAlreadyConfigured) {
    const wantAuth = await io.askConfirm('Do you want to configure enterprise SSO (Microsoft Entra ID)?', false);
    if (wantAuth) {
      const tenantId = await io.askText('Tenant ID (from Azure portal → Entra ID)', '');
      const clientId = await io.askText('Client ID (application ID)', '');
      const clientSecret = await io.askText('Client secret', '');
      if (tenantId && clientId && clientSecret) {
        await io.suspendTerminal(async () => {
          await doInitAuth({ tenantId, clientId, clientSecret, redirectUri: REDIRECT_URI });
          console.log(chalk.green('✓ Enterprise auth configured.'));
          console.log(chalk.gray('  Run: ctxhub login  (to sign in and obtain a session token)'));
        });
      } else {
        console.log(chalk.yellow('Skipped: tenant ID, client ID, and client secret are all required.'));
      }
    }
  }

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

  if (config.repositories.length) {
    if (config.llm.enabled) {
      await io.suspendTerminal(() => narrateOrientation(cwd, config, deps));
    } else {
      console.log(chalk.dim(`\n${llmDisabledNotice('a workspace orientation summary for new team members')}`));
    }
  }

  console.log(chalk.bold.green('\nOnboarding complete.') + chalk.gray(' Run `ctxhub doctor` any time to check workspace health.'));
}

// Runs after every other onboarding step so it can cite the just-built index and repo list --
// a "here's what this workspace is" briefing for whoever gets handed this workspace next,
// grounded only in evidence ctxhub actually indexed (never invents a repo/file it didn't see).
async function narrateOrientation(cwd: string, config: CtxhubConfig, deps: OnboardDeps): Promise<void> {
  console.log(chalk.gray('\nGenerating a workspace orientation summary...'));
  const pack = await deps.createContextPack('architecture overview and repo ownership', 8, cwd);
  const result = await deps.runAgentPrompt(config, buildOrientationPrompt(pack));

  if (!result.ok) {
    console.log(chalk.yellow(`Orientation summary unavailable (${result.reason}); skipping.`));
    return;
  }

  console.log(`\n${chalk.bold('Workspace orientation')}`);
  console.log(result.text.trim());
}

function buildOrientationPrompt(pack: Awaited<ReturnType<typeof createContextPack>>): string {
  const repos = pack.repos.map(repo => `- ${repo.name} (${repo.path})`).join('\n') || '(none configured yet)';
  const architecture = pack.architecture
    .map(item => `- ${item.repo}:${item.filePath}${item.title ? ` (${item.title})` : ''}\n  ${item.snippet}`)
    .join('\n') || '(none indexed yet)';
  const docs = pack.search
    .slice(0, 5)
    .map(item => `- ${item.repo}:${item.filePath}${item.title ? ` (${item.title})` : ''}`)
    .join('\n') || '(none indexed yet)';

  return [
    'You are orienting a new engineer joining this multi-repo workspace for the first time.',
    '',
    `Configured repos:\n${repos}`,
    '',
    `Architecture evidence (cite only these repo:path pairs, never invent one that is not listed):\n${architecture}`,
    '',
    `Other relevant docs:\n${docs}`,
    '',
    'Write a short (4-6 sentence) orientation covering what this workspace is, how the repos relate, ' +
      'and what a new engineer should look at first. Cite repo:path for any specific claim. If the evidence ' +
      "is too sparse to say much, say so plainly instead of guessing."
  ].join('\n');
}
