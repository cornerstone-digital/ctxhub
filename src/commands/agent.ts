import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { pathExists, readText, writeText } from '../utils/fs.js';

export const MCP_CONFIG_FILE = '.mcp.json';
export const SUPPORTED_AGENTS = ['claude'] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

type McpConfigFile = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

export async function writeSsdMcpConfig(cwd = process.cwd()): Promise<{ path: string; changed: boolean }> {
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
  if (!(SUPPORTED_AGENTS as readonly string[]).includes(agent)) {
    throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_AGENTS.join(', ')}`);
  }

  const { path: configPath, changed } = await writeSsdMcpConfig();
  console.log(chalk.green(`${changed ? 'Wrote' : 'Confirmed'} ssd MCP server in ${configPath}`));

  if (opts.launch === false) {
    console.log(chalk.gray(`Skipping launch (--no-launch). Run \`${agent}\` yourself to pick it up.`));
    return;
  }

  console.log(chalk.gray(`Launching ${agent}...`));
  const code = await launchAgentBinary(agent);
  if (code !== 0) process.exitCode = code;
}
