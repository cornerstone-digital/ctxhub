import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { parse, stringify } from 'smol-toml';
import { pathExists, readText, writeText } from '../utils/fs.js';
import { loadConfig, loadWorkspaceConfig } from '../config/config.js';
import { isMempalaceAvailable } from '../memory/LocalJsonMemory.js';

export const MCP_CONFIG_FILE = '.mcp.json';
export const CODEX_CONFIG_FILE = path.join('.codex', 'config.toml');
export const SUPPORTED_AGENTS = ['claude', 'codex', 'copilot'] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export type AgentConfigResult = { path: string; changed: boolean; note?: string };

// The shape ctxhub currently writes for each agent's MCP entry. `doctor` compares an
// already-installed entry against these to detect drift after a ctxhub upgrade.
export const CLAUDE_CODEX_MCP_ENTRY = { command: 'ctxhub', args: ['mcp'] };
export const COPILOT_MCP_ENTRY = { type: 'local', command: 'ctxhub', args: ['mcp'], tools: ['*'] };

const MEMPALACE_NOTE =
  'Also wired up MemPalace\'s MCP server (mempalace-mcp) alongside ctxhub\'s — that\'s where an agent should ' +
  'write durable notes/decisions (mempalace_add_drawer, mempalace_checkpoint, etc.), not ctxhub\'s own index, ' +
  'which stays a read-only mirror of this workspace\'s actual repo content.';

// MemPalace ships its own full MCP tool surface (search + write: mempalace_add_drawer,
// mempalace_checkpoint, mempalace_diary_write, etc.) via a separate `mempalace-mcp` binary.
// ctxhub doesn't reimplement agent note-taking -- it just wires MemPalace's server in
// alongside its own when it's the configured memory provider and actually available.
async function getMempalaceMcpEntry(cwd: string): Promise<{ command: string; args: string[] } | undefined> {
  const config = await loadConfig(cwd).catch(() => undefined);
  if (config?.memory.provider !== 'mempalace') return undefined;
  if (!(await isMempalaceAvailable())) return undefined;
  return { command: 'mempalace-mcp', args: [] };
}

async function resolveAgentConfigRoot(cwd: string): Promise<string> {
  return loadWorkspaceConfig(cwd).then(workspace => workspace.workspaceRoot).catch(() => cwd);
}

function mergeEntries(
  existing: Record<string, unknown> | undefined,
  entries: Record<string, unknown>
): { merged: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const merged = { ...existing };
  for (const [name, entry] of Object.entries(entries)) {
    if (JSON.stringify(merged[name]) !== JSON.stringify(entry)) {
      changed = true;
      merged[name] = entry;
    }
  }
  return { merged, changed };
}

type McpConfigFile = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

export async function writeClaudeMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configRoot = await resolveAgentConfigRoot(cwd);
  const configPath = path.join(configRoot, MCP_CONFIG_FILE);
  const existing: McpConfigFile = (await pathExists(configPath)) ? JSON.parse(await readText(configPath)) : {};

  const mempalace = await getMempalaceMcpEntry(configRoot);
  const entries: Record<string, unknown> = { ctxhub: CLAUDE_CODEX_MCP_ENTRY };
  if (mempalace) entries.mempalace = mempalace;

  const { merged: mergedServers, changed } = mergeEntries(existing.mcpServers, entries);
  if (changed) {
    await writeText(configPath, `${JSON.stringify({ ...existing, mcpServers: mergedServers }, null, 2)}\n`);
  }

  return { path: configPath, changed, note: mempalace ? MEMPALACE_NOTE : undefined };
}

type CodexConfigFile = { mcp_servers?: Record<string, unknown> } & Record<string, unknown>;

const CODEX_TRUST_NOTE =
  'Codex only loads project-scoped .codex/config.toml for projects it trusts — ' +
  'if Codex does not pick up the ctxhub server, trust this project in Codex first.';

export async function writeCodexMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configRoot = await resolveAgentConfigRoot(cwd);
  const configPath = path.join(configRoot, CODEX_CONFIG_FILE);
  const existing: CodexConfigFile = (await pathExists(configPath)) ? (parse(await readText(configPath)) as CodexConfigFile) : {};

  const mempalace = await getMempalaceMcpEntry(configRoot);
  const entries: Record<string, unknown> = { ctxhub: CLAUDE_CODEX_MCP_ENTRY };
  if (mempalace) entries.mempalace = mempalace;

  const { merged: mergedServers, changed } = mergeEntries(existing.mcp_servers, entries);
  if (changed) {
    await writeText(configPath, stringify({ ...existing, mcp_servers: mergedServers }));
  }

  const notes = [CODEX_TRUST_NOTE, ...(mempalace ? [MEMPALACE_NOTE] : [])];
  return { path: configPath, changed, note: notes.join(' ') };
}

const COPILOT_SCOPE_NOTE =
  'This is a user-level config (~/.copilot/mcp-config.json, or $COPILOT_HOME) shared across all your projects — ' +
  'GitHub found no supported project-scoped file for the Copilot CLI. The ctxhub server still uses whatever ' +
  'directory `copilot` is launched from, so this works per-project in practice.';

export function copilotConfigPath(): string {
  return path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'mcp-config.json');
}

export async function writeCopilotMcpConfig(cwd = process.cwd()): Promise<AgentConfigResult> {
  const configPath = copilotConfigPath();
  const existing: McpConfigFile = (await pathExists(configPath)) ? JSON.parse(await readText(configPath)) : {};

  const configRoot = await resolveAgentConfigRoot(cwd);
  const mempalace = await getMempalaceMcpEntry(configRoot);
  const entries: Record<string, unknown> = { ctxhub: COPILOT_MCP_ENTRY };
  if (mempalace) entries.mempalace = { type: 'local', ...mempalace, tools: ['*'] };

  const { merged: mergedServers, changed } = mergeEntries(existing.mcpServers, entries);
  if (changed) {
    await writeText(configPath, `${JSON.stringify({ ...existing, mcpServers: mergedServers }, null, 2)}\n`);
  }

  const notes = [COPILOT_SCOPE_NOTE, ...(mempalace ? [MEMPALACE_NOTE] : [])];
  return { path: configPath, changed, note: notes.join(' ') };
}

export async function readInstalledMcpEntry(agent: SupportedAgent, cwd = process.cwd()): Promise<unknown> {
  const configRoot = await resolveAgentConfigRoot(cwd);
  if (agent === 'claude') {
    const configPath = path.join(configRoot, MCP_CONFIG_FILE);
    if (!(await pathExists(configPath))) return undefined;
    const parsed: McpConfigFile = JSON.parse(await readText(configPath));
    return parsed.mcpServers?.ctxhub;
  }

  if (agent === 'codex') {
    const configPath = path.join(configRoot, CODEX_CONFIG_FILE);
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

export const CONFIG_WRITERS: Record<SupportedAgent, (cwd?: string) => Promise<AgentConfigResult>> = {
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
