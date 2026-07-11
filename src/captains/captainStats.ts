import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

// Lightweight read-modify-write counter for captain promotion tracking.
// Stored at ~/.ctxhub/captain-stats.json — outside any workspace so it
// spans all workspaces and survives workspace re-inits.
//
// Shape: { [taskName]: { runs: number; promoted: number } }
// We can't derive `runs` reliably by counting files (a run can be deleted),
// so we accumulate both counters here as events occur. Both are best-effort:
// a crashed process may under-count, but never over-count.

type TaskStats = { runs: number; promoted: number };
type StatsFile = Record<string, TaskStats>;

function statsPath(): string {
  return path.join(getCtxhubHome(), 'captain-stats.json');
}

async function readStats(): Promise<StatsFile> {
  const p = statsPath();
  if (!(await pathExists(p))) return {};
  try {
    return JSON.parse(await readText(p)) as StatsFile;
  } catch {
    return {};
  }
}

async function writeStats(stats: StatsFile): Promise<void> {
  await writeText(statsPath(), `${JSON.stringify(stats, null, 2)}\n`);
}

export async function recordCaptainRun(taskName: string): Promise<void> {
  const stats = await readStats();
  const current = stats[taskName] ?? { runs: 0, promoted: 0 };
  stats[taskName] = { ...current, runs: current.runs + 1 };
  await writeStats(stats);
}

export async function recordCaptainPromotion(taskName: string): Promise<void> {
  const stats = await readStats();
  const current = stats[taskName] ?? { runs: 0, promoted: 0 };
  stats[taskName] = { ...current, promoted: current.promoted + 1 };
  await writeStats(stats);
}

export async function getCaptainStats(): Promise<StatsFile> {
  return readStats();
}

export async function getCaptainTaskStats(taskName: string): Promise<TaskStats> {
  const stats = await readStats();
  return stats[taskName] ?? { runs: 0, promoted: 0 };
}
