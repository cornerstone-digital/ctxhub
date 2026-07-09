import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { parse, stringify } from 'smol-toml';
import { pathExists, readText, writeText } from '../utils/fs.js';

export const MCP_CONFIG_FILE = '.mcp.json';
export const CODEX_CONFIG_FILE = path.join('.codex', 'config.toml');
export const SUPPORTED_AGENTS = ['claude', 'codex', 'copilot'] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export type AgentConfigResult = { path: string; changed: boolean; note?: string };

// The shape ctxhub currently writes for each agent's MCP entry. `doctor` compares an
// already-installed entry against these to detect drift after a ctxhub upgrade.
export const CLAUDE_CODEX_MCP_ENTRY = { command: 'ctxhub', args: ['mcp'] };
export const COPILOT_MCP_ENTRY = { type: 'local', command: 'ctxhub', args: ['mcp'], tools: ['*'] };

type McpConfigFile = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

export async function writeClaudeMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configPath = path.join(cwd, MCP_CONFIG_FILE);
  const existing: McpConfigFile = (await pathExists(configPath)) ? JSON.parse(await readText(configPath)) : {};
  const changed = JSON.stringify(existing.mcpServers?.ctxhub) !== JSON.stringify(CLAUDE_CODEX_MCP_ENTRY);

  if (changed) {
    const merged: McpConfigFile = {
      ...existing,
      mcpServers: { ...existing.mcpServers, ctxhub: CLAUDE_CODEX_MCP_ENTRY }
    };
    await writeText(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  }

  return { path: configPath, changed };
}

type CodexConfigFile = { mcp_servers?: Record<string, unknown> } & Record<string, unknown>;

const CODEX_TRUST_NOTE =
  'Codex only loads project-scoped .codex/config.toml for projects it trusts — ' +
  'if Codex does not pick up the ctxhub server, trust this project in Codex first.';

export async function writeCodexMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configPath = path.join(cwd, CODEX_CONFIG_FILE);
  const existing: CodexConfigFile = (await pathExists(configPath)) ? (parse(await readText(configPath)) as CodexConfigFile) : {};
  const changed = JSON.stringify(existing.mcp_servers?.ctxhub) !== JSON.stringify(CLAUDE_CODEX_MCP_ENTRY);

  if (changed) {
    const merged: CodexConfigFile = {
      ...existing,
      mcp_servers: { ...existing.mcp_servers, ctxhub: CLAUDE_CODEX_MCP_ENTRY }
    };
    await writeText(configPath, stringify(merged));
  }

  return { path: configPath, changed, note: CODEX_TRUST_NOTE };
}

const COPILOT_SCOPE_NOTE =
  'This is a user-level config (~/.copilot/mcp-config.json, or $COPILOT_HOME) shared across all your projects — ' +
  'GitHub found no supported project-scoped file for the Copilot CLI. The ctxhub server still uses whatever ' +
  'directory `copilot` is launched from, so this works per-project in practice.';

export function copilotConfigPath(): string {
  return path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'mcp-config.json');
}

export async function writeCopilotMcpConfig(): Promise<AgentConfigResult> {
  const configPath = copilotConfigPath();
  const existing: McpConfigFile = (await pathExists(configPath)) ? JSON.parse(await readText(configPath)) : {};
  const changed = JSON.stringify(existing.mcpServers?.ctxhub) !== JSON.stringify(COPILOT_MCP_ENTRY);

  if (changed) {
    const merged: McpConfigFile = {
      ...existing,
      mcpServers: { ...existing.mcpServers, ctxhub: COPILOT_MCP_ENTRY }
    };
    await writeText(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  }

  return { path: configPath, changed, note: COPILOT_SCOPE_NOTE };
}

export async function readInstalledMcpEntry(agent: SupportedAgent, cwd = process.cwd()): Promise<unknown> {
  if (agent === 'claude') {
    const configPath = path.join(cwd, MCP_CONFIG_FILE);
    if (!(await pathExists(configPath))) return undefined;
    const parsed: McpConfigFile = JSON.parse(await readText(configPath));
    return parsed.mcpServers?.ctxhub;
  }

  if (agent === 'codex') {
    const configPath = path.join(cwd, CODEX_CONFIG_FILE);
    if (!(await pathExists(configPath))) return undefined;
    const parsed = parse(await readText(configPath)) as CodexConfigFile;
    return parsed.mcp_servers?.ctxhub;
  }

  const configPath = copilotConfigPath();
  if (!(await pathExists(configPath))) return undefined;
  const parsed: McpConfigFile = JSON.parse(await readText(configPath));
  return parsed.mcpServers?.ctxhub;
}

export function expectedMcpEntry(agent: SupportedAgent): unknown {
  return agent === 'copilot' ? COPILOT_MCP_ENTRY : CLAUDE_CODEX_MCP_ENTRY;
}

const CONFIG_WRITERS: Record<SupportedAgent, (cwd?: string) => Promise<AgentConfigResult>> = {
  claude: writeClaudeMcpConfig,
  codex: writeCodexMcpConfig,
  copilot: writeCopilotMcpConfig
};

export function launchAgentBinary(command: string, args: string[] = [], cwd = process.cwd()): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`${command} was not found on PATH. Install it, then re-run this command.`));
      } else {
        reject(error);
      }
    });
    child.on('close', code => resolve(code ?? 0));
  });
}

export async function agentLaunchCommand(agent: string, opts: { launch?: boolean } = {}) {
  const writeConfig = CONFIG_WRITERS[agent as SupportedAgent];
  if (!writeConfig) {
    throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_AGENTS.join(', ')}`);
  }

  const { path: configPath, changed, note } = await writeConfig();
  console.log(chalk.green(`${changed ? 'Wrote' : 'Confirmed'} ctxhub MCP server in ${configPath}`));
  if (note) console.log(chalk.yellow(note));

  if (opts.launch === false) {
    console.log(chalk.gray(`Skipping launch (--no-launch). Run \`${agent}\` yourself to pick it up.`));
    return;
  }

  console.log(chalk.gray(`Launching ${agent}...`));
  const code = await launchAgentBinary(agent);
  if (code !== 0) process.exitCode = code;
}
