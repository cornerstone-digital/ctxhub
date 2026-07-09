import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { parse, stringify } from 'smol-toml';
import { pathExists, readText, writeText } from '../utils/fs.js';

export const MCP_CONFIG_FILE = '.mcp.json';
export const CODEX_CONFIG_FILE = path.join('.codex', 'config.toml');
export const SUPPORTED_AGENTS = ['claude', 'codex'] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export type AgentConfigResult = { path: string; changed: boolean; note?: string };

type McpConfigFile = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

export async function writeClaudeMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configPath = path.join(cwd, MCP_CONFIG_FILE);
  const existing: McpConfigFile = (await pathExists(configPath)) ? JSON.parse(await readText(configPath)) : {};
  const ssdEntry = { command: 'ssd', args: ['mcp'] };
  const changed = JSON.stringify(existing.mcpServers?.ssd) !== JSON.stringify(ssdEntry);

  if (changed) {
    const merged: McpConfigFile = {
      ...existing,
      mcpServers: { ...existing.mcpServers, ssd: ssdEntry }
    };
    await writeText(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  }

  return { path: configPath, changed };
}

type CodexConfigFile = { mcp_servers?: Record<string, unknown> } & Record<string, unknown>;

const CODEX_TRUST_NOTE =
  'Codex only loads project-scoped .codex/config.toml for projects it trusts — ' +
  'if Codex does not pick up the ssd server, trust this project in Codex first.';

export async function writeCodexMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configPath = path.join(cwd, CODEX_CONFIG_FILE);
  const existing: CodexConfigFile = (await pathExists(configPath)) ? (parse(await readText(configPath)) as CodexConfigFile) : {};
  const ssdEntry = { command: 'ssd', args: ['mcp'] };
  const changed = JSON.stringify(existing.mcp_servers?.ssd) !== JSON.stringify(ssdEntry);

  if (changed) {
    const merged: CodexConfigFile = {
      ...existing,
      mcp_servers: { ...existing.mcp_servers, ssd: ssdEntry }
    };
    await writeText(configPath, stringify(merged));
  }

  return { path: configPath, changed, note: CODEX_TRUST_NOTE };
}

const CONFIG_WRITERS: Record<SupportedAgent, (cwd?: string) => Promise<AgentConfigResult>> = {
  claude: writeClaudeMcpConfig,
  codex: writeCodexMcpConfig
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
  console.log(chalk.green(`${changed ? 'Wrote' : 'Confirmed'} ssd MCP server in ${configPath}`));
  if (note) console.log(chalk.yellow(note));

  if (opts.launch === false) {
    console.log(chalk.gray(`Skipping launch (--no-launch). Run \`${agent}\` yourself to pick it up.`));
    return;
  }

  console.log(chalk.gray(`Launching ${agent}...`));
  const code = await launchAgentBinary(agent);
  if (code !== 0) process.exitCode = code;
}
