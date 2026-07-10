import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathExists, readText } from '../utils/fs.js';
import type { CtxhubConfig } from '../config/types.js';

export type MempalaceRoomSummary = {
  wing: string;
  room: string;
  count: number;
};

export type MempalaceStatusSummary = {
  available: boolean;
  note?: string;
  totalDrawers?: number;
  items: MempalaceRoomSummary[];
};

export type MempalaceSearchHit = {
  text: string;
  wing: string;
  room: string;
  source_file?: string;
  source_path?: string;
  created_at?: string;
  similarity?: number;
  matched_via?: string;
  drawer_index?: number;
  total_drawers?: number;
};

export type MempalaceSearchResult = {
  query: string;
  filters?: { wing?: string; room?: string; source_file?: string };
  total_before_filter?: number;
  results: MempalaceSearchHit[];
  error?: string;
  hint?: string;
  vector_disabled?: boolean;
  vector_disabled_reason?: string;
};

export type MempalaceTimelineResult = {
  entity?: string;
  timeline?: unknown[];
  count?: number;
  error?: string;
};

export type MempalaceWriteResult = {
  success?: boolean;
  error?: string;
  hint?: string;
  [key: string]: unknown;
};

type CliResult = { stdout: string; stderr: string; exitCode: number };

export async function readMempalaceStatusSummary(config: CtxhubConfig, workspaceRoot = process.cwd()): Promise<MempalaceStatusSummary> {
  if (config.memory.provider !== 'mempalace') {
    return { available: false, note: 'disabled (memory.provider is not mempalace)', items: [] };
  }

  const result = await runMempalaceCommand(['status'], config, workspaceRoot);
  const combined = `${result.stdout}\n${result.stderr}`.trim();

  if (combined.includes('No palace found')) {
    return { available: false, note: 'no palace found; run mempalace init <dir> then mempalace mine <dir>', items: [] };
  }

  if (result.exitCode !== 0) {
    return { available: false, note: `status unavailable (exit ${result.exitCode})`, items: [] };
  }

  const parsed = parseMempalaceStatus(combined);
  return {
    available: true,
    totalDrawers: parsed.totalDrawers,
    note: `${parsed.totalDrawers ?? 0} drawers across ${parsed.items.length} room(s)`,
    items: parsed.items
  };
}

export function parseMempalaceStatus(output: string): { totalDrawers?: number; items: MempalaceRoomSummary[] } {
  const totalDrawers = output.match(/MemPalace Status\s+—\s+(\d+) drawers/)?.[1];
  const lines = output.split('\n');
  const items: MempalaceRoomSummary[] = [];
  let currentWing: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const wingMatch = line.match(/^\s*WING:\s+(.+)$/);
    if (wingMatch) {
      currentWing = wingMatch[1].trim();
      continue;
    }

    const roomMatch = line.match(/^\s*ROOM:\s+(.+?)\s+(\d+) drawers$/);
    if (roomMatch && currentWing) {
      items.push({ wing: currentWing, room: roomMatch[1].trim(), count: Number(roomMatch[2]) });
    }
  }

  return { totalDrawers: totalDrawers ? Number(totalDrawers) : undefined, items };
}

export async function searchMempalace(
  config: CtxhubConfig,
  workspaceRoot: string,
  input: { query: string; wing?: string; room?: string; sourceFile?: string; limit?: number },
  runJsonFn: typeof runMempalaceJson = runMempalaceJson
): Promise<MempalaceSearchResult> {
  if (config.memory.provider !== 'mempalace') {
    return { query: input.query, results: [], error: 'ctxhub is not configured to use MemPalace for durable memory.' };
  }

  return runJsonFn(
    {
      query: input.query,
      wing: input.wing,
      room: input.room,
      source_file: input.sourceFile,
      limit: input.limit ?? 5
    },
    config,
    workspaceRoot,
    [
      'import json, sys',
      'from mempalace.searcher import search_memories',
      'payload = json.loads(sys.argv[1])',
      'result = search_memories(',
      '  payload["query"],',
      '  palace_path=payload["palace_path"],',
      '  wing=payload.get("wing"),',
      '  room=payload.get("room"),',
      '  source_file=payload.get("source_file"),',
      '  n_results=payload.get("limit", 5),',
      ')',
      'print(json.dumps(result, ensure_ascii=False))'
    ].join('\n')
  ) as Promise<MempalaceSearchResult>;
}

export async function timelineMempalace(
  config: CtxhubConfig,
  workspaceRoot: string,
  input: { entity?: string },
  runJsonFn: typeof runMempalaceJson = runMempalaceJson
): Promise<MempalaceTimelineResult> {
  if (config.memory.provider !== 'mempalace') {
    return { error: 'ctxhub is not configured to use MemPalace for durable memory.' };
  }

  return runJsonFn(
    { entity: input.entity },
    config,
    workspaceRoot,
    [
      'import json, sys',
      'from mempalace.mcp_server import tool_kg_timeline',
      'payload = json.loads(sys.argv[1])',
      'result = tool_kg_timeline(payload.get("entity"))',
      'print(json.dumps(result, ensure_ascii=False))'
    ].join('\n')
  ) as Promise<MempalaceTimelineResult>;
}

export async function addDrawerMempalace(
  config: CtxhubConfig,
  workspaceRoot: string,
  input: { wing: string; room: string; content: string; sourceFile?: string; addedBy?: string },
  runJsonFn: typeof runMempalaceJson = runMempalaceJson
): Promise<MempalaceWriteResult> {
  if (config.memory.provider !== 'mempalace') {
    return { error: 'ctxhub is not configured to use MemPalace for durable memory.' };
  }

  return runJsonFn(
    {
      wing: input.wing,
      room: input.room,
      content: input.content,
      source_file: input.sourceFile,
      added_by: input.addedBy ?? 'ctxhub-memory-add'
    },
    config,
    workspaceRoot,
    [
      'import json, sys',
      'from mempalace.mcp_server import tool_add_drawer',
      'payload = json.loads(sys.argv[1])',
      'result = tool_add_drawer(',
      '  wing=payload["wing"],',
      '  room=payload["room"],',
      '  content=payload["content"],',
      '  source_file=payload.get("source_file"),',
      '  added_by=payload.get("added_by", "ctxhub-memory-add"),',
      ')',
      'print(json.dumps(result, ensure_ascii=False))'
    ].join('\n')
  ) as Promise<MempalaceWriteResult>;
}

export async function writeDiaryMempalace(
  config: CtxhubConfig,
  workspaceRoot: string,
  input: { agentName: string; entry: string; topic?: string; wing?: string },
  runJsonFn: typeof runMempalaceJson = runMempalaceJson
): Promise<MempalaceWriteResult> {
  if (config.memory.provider !== 'mempalace') {
    return { error: 'ctxhub is not configured to use MemPalace for durable memory.' };
  }

  return runJsonFn(
    {
      agent_name: input.agentName,
      entry: input.entry,
      topic: input.topic ?? 'general',
      wing: input.wing ?? ''
    },
    config,
    workspaceRoot,
    [
      'import json, sys',
      'from mempalace.mcp_server import tool_diary_write',
      'payload = json.loads(sys.argv[1])',
      'result = tool_diary_write(',
      '  agent_name=payload["agent_name"],',
      '  entry=payload["entry"],',
      '  topic=payload.get("topic", "general"),',
      '  wing=payload.get("wing", ""),',
      ')',
      'print(json.dumps(result, ensure_ascii=False))'
    ].join('\n')
  ) as Promise<MempalaceWriteResult>;
}

// Some internal MemPalace modules we call into (e.g. `mempalace.mcp_server`, which is written
// to run as a stdio MCP server) redirect stdout for protocol hygiene, so the JSON payload our
// script prints can land on stderr instead -- mixed in with log lines like "Embedding function
// initialized...". `mempalace.searcher` has no such redirection, so its output stays clean on
// stdout. Rather than assume one stream, try both wholesale first (handles clean single-stream
// output, including multi-line JSON), then fall back to scanning every line of both streams and
// keeping the last one that parses -- the JSON print is always the final statement in every
// script, so it's always the last valid-JSON line even when preceded by unrelated log noise.
export function extractJsonPayload(stdout: string, stderr: string): unknown {
  for (const candidate of [stdout.trim(), stderr.trim()]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Not parseable as a whole -- fall through to line-by-line scanning below.
    }
  }

  let lastParsed: unknown;
  let found = false;
  for (const line of [...stdout.split('\n'), ...stderr.split('\n')]) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lastParsed = JSON.parse(trimmed);
      found = true;
    } catch {
      // Not a JSON line -- e.g. a log message; keep scanning.
    }
  }

  return found ? lastParsed : undefined;
}

async function runMempalaceJson(payload: Record<string, unknown>, config: CtxhubConfig, workspaceRoot: string, script: string): Promise<unknown> {
  const python = await resolveMempalacePython();
  if (!python) {
    return { error: 'MemPalace CLI not found. Install with: uv tool install mempalace' };
  }

  const palacePath = resolvePalacePath(config, workspaceRoot);
  const env = { ...process.env, MEMPALACE_PALACE_PATH: palacePath };
  const result = await runProcess(python, ['-c', script, JSON.stringify({ ...payload, palace_path: palacePath })], env);
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (combined.includes('No palace found')) {
    return { error: 'No palace found', hint: 'Run: mempalace init <dir> then mempalace mine <dir>' };
  }
  if (result.exitCode !== 0) {
    return { error: combined || `MemPalace call failed with exit ${result.exitCode}` };
  }
  const parsed = extractJsonPayload(result.stdout, result.stderr);
  return parsed === undefined ? { error: 'MemPalace returned invalid JSON output.' } : parsed;
}

async function runMempalaceCommand(args: string[], config: CtxhubConfig, workspaceRoot: string): Promise<CliResult> {
  const env = { ...process.env, MEMPALACE_PALACE_PATH: resolvePalacePath(config, workspaceRoot) };
  return runProcess('mempalace', args, env);
}

async function resolveMempalacePython(): Promise<string | undefined> {
  const executable = await findExecutableOnPath('mempalace');
  if (!executable) return undefined;
  const resolved = await realpath(executable).catch(() => executable);
  const firstLine = (await readText(resolved)).split('\n')[0] ?? '';
  const match = firstLine.match(/^#!\s*(.+)$/);
  if (!match) return undefined;
  const tokens = match[1].trim().split(/\s+/);
  return tokens[0].endsWith('env') ? tokens.at(-1) : tokens[0];
}

async function findExecutableOnPath(name: string): Promise<string | undefined> {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];

  for (const entry of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = path.join(entry, process.platform === 'win32' ? `${name}${suffix}` : name);
      if (await pathExists(candidate)) return candidate;
    }
  }

  return undefined;
}

function resolvePalacePath(config: CtxhubConfig, workspaceRoot: string): string {
  if (config.memory.path.startsWith('~/')) {
    return path.join(process.env.HOME ?? '', config.memory.path.slice(2));
  }
  return path.isAbsolute(config.memory.path) ? config.memory.path : path.resolve(workspaceRoot, config.memory.path);
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => (stdout += String(chunk)));
    child.stderr?.on('data', chunk => (stderr += String(chunk)));
    child.on('error', error => resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 1 }));
    child.on('close', exitCode => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
  });
}