import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText } from '../utils/fs.js';
import type { CtxhubEventEnvelope } from './eventBus.js';

// Durable append-only event log at ~/.ctxhub/events.jsonl
// One JSON envelope per line (JSONL format). Written on every eventBus publish.
// Survives process restarts so the Mission Control timeline shows full history,
// not just events since the last `ctxhub service` start.
//
// Growth: ~200-500 bytes per event. High-frequency events (index.progress, job.queued)
// are excluded (see SKIP_LOG_TYPES). A busy workspace with hourly captain runs +
// daily jobs produces ~10-20 meaningful events/day => ~10 KB/day => ~3.5 MB/year.
// No rotation implemented -- if that becomes a problem it's a simple head/tail slice.

export function getEventLogPath(): string {
  return path.join(getCtxhubHome(), 'events.jsonl');
}

// High-frequency events excluded from the durable log. These fire on every file
// scanned (index.progress) or every scheduler tick (job.queued) and would
// flood the log with noise. The Timeline view already filters them client-side;
// keeping them out of the file prevents unbounded disk growth.
const SKIP_LOG_TYPES = new Set<CtxhubEventEnvelope['type']>(['index.progress', 'job.queued']);

// Appends an event envelope to the durable log. Fire-and-forget: a write failure
// must never kill the event publish flow. Errors are silently swallowed.
export async function appendEventLog(envelope: CtxhubEventEnvelope): Promise<void> {
  if (SKIP_LOG_TYPES.has(envelope.type)) return;
  try {
    await appendFile(getEventLogPath(), `${JSON.stringify(envelope)}\n`, 'utf8');
  } catch {
    // Best-effort only -- log full on disk, permission error, etc.
  }
}

export type EventLogQuery = {
  limit?: number;
  before?: string; // ISO timestamp -- return events older than this
  types?: string[]; // filter to specific event types
};

// Reads the event log from disk, newest-first. Efficient for the common case
// (last N events) by reading the whole file but slicing after parsing.
// For a file growing at ~3.5 MB/year this is fine; streaming reads can be
// added later if warranted.
export async function readEventLog(query: EventLogQuery = {}): Promise<CtxhubEventEnvelope[]> {
  const logPath = getEventLogPath();
  if (!(await pathExists(logPath))) return [];

  const raw = await readText(logPath);
  const lines = raw.split('\n').filter(l => l.trim());

  const envelopes: CtxhubEventEnvelope[] = [];
  for (const line of lines) {
    try {
      envelopes.push(JSON.parse(line) as CtxhubEventEnvelope);
    } catch {
      // Skip malformed lines (e.g. partial write during a crash).
    }
  }

  // Newest-first
  envelopes.reverse();

  // Apply filters
  let filtered = envelopes;
  if (query.before) {
    filtered = filtered.filter(e => e.at < query.before!);
  }
  if (query.types?.length) {
    // Support both exact matches ('captain.run.promoted') and prefix matches ('captain').
    // Prefix match uses dot-boundary so 'captain' matches 'captain.run.started' but not
    // a hypothetical 'captaineer' type.
    filtered = filtered.filter(e =>
      query.types!.some(t => e.type === t || e.type.startsWith(t + '.'))
    );
  }

  return filtered.slice(0, query.limit ?? 100);
}
