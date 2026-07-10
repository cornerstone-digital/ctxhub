import fs from 'node:fs';
import { pathExists, readText, writeText } from './fs.js';

export type ToolUsage = { calls: number; tokensReturned: number; tokensBaseline: number };
export type UsageStats = { since: string; lastUpdated: string; tools: Record<string, ToolUsage> };

type StatFn = (path: string) => { size: number };

// Deliberately just the sum of each distinct matched file's on-disk size (chars/4):
// the honest baseline for "what ctxhub replaced" is an agent opening every distinct file
// that showed up in the results directly, rather than getting a targeted chunk/snippet.
// This is a heuristic, not exact accounting -- it's meant as a directional savings signal.
export function estimateBaselineTokensFromFileSizes(absolutePaths: Array<string | undefined>, statFn: StatFn = fs.statSync): number {
  const unique = [...new Set(absolutePaths.filter((path): path is string => Boolean(path)))];
  let total = 0;
  for (const path of unique) {
    try {
      total += Math.ceil(statFn(path).size / 4);
    } catch {
      // File may have been deleted/moved since indexing -- skip rather than fail the whole calculation.
    }
  }
  return total;
}

// Best-effort telemetry: never let a failure here break the tool call that triggered it.
// A read-modify-write without locking can undercount if multiple ctxhub MCP processes
// write concurrently against the same workspace -- acceptable for a directional metric.
export async function recordToolUsage(statsPath: string, tool: string, tokensReturned: number, tokensBaseline: number): Promise<void> {
  try {
    const stats = (await readUsageStats(statsPath)) ?? { since: new Date().toISOString(), lastUpdated: '', tools: {} };
    const existing = stats.tools[tool] ?? { calls: 0, tokensReturned: 0, tokensBaseline: 0 };
    stats.tools[tool] = {
      calls: existing.calls + 1,
      tokensReturned: existing.tokensReturned + tokensReturned,
      tokensBaseline: existing.tokensBaseline + tokensBaseline
    };
    stats.lastUpdated = new Date().toISOString();
    await writeText(statsPath, JSON.stringify(stats, null, 2));
  } catch {
    // Swallow -- telemetry must never break the tool response it's attached to.
  }
}

export async function readUsageStats(statsPath: string): Promise<UsageStats | undefined> {
  if (!(await pathExists(statsPath))) return undefined;
  try {
    return JSON.parse(await readText(statsPath)) as UsageStats;
  } catch {
    return undefined;
  }
}

export type UsageSummary = {
  since?: string;
  lastUpdated?: string;
  totalCalls: number;
  tokensReturned: number;
  tokensBaseline: number;
  tokensSaved: number;
  savingsPercent: number;
  tools: Array<{ tool: string } & ToolUsage & { tokensSaved: number }>;
};

export function summarizeUsageStats(stats: UsageStats | undefined): UsageSummary {
  const tools = Object.entries(stats?.tools ?? {})
    .map(([tool, usage]) => ({ tool, ...usage, tokensSaved: usage.tokensBaseline - usage.tokensReturned }))
    .sort((a, b) => b.tokensSaved - a.tokensSaved);

  const totalCalls = tools.reduce((sum, t) => sum + t.calls, 0);
  const tokensReturned = tools.reduce((sum, t) => sum + t.tokensReturned, 0);
  const tokensBaseline = tools.reduce((sum, t) => sum + t.tokensBaseline, 0);
  const tokensSaved = tokensBaseline - tokensReturned;

  return {
    since: stats?.since,
    lastUpdated: stats?.lastUpdated,
    totalCalls,
    tokensReturned,
    tokensBaseline,
    tokensSaved,
    savingsPercent: tokensBaseline > 0 ? Math.round((tokensSaved / tokensBaseline) * 1000) / 10 : 0,
    tools
  };
}
