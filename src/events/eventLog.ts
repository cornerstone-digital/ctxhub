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
// Growth: ~200-500 bytes per event. A busy workspace with hourly captain runs +
// daily jobs produces ~10-20 events/day => ~10 KB/day => ~3.5 MB/year.
// No rotation implemented here -- if that becomes a problem it's a simple
// head/tail slice. Not a problem worth solving now.

export function getEventLogPath(): string {
  return path.join(getCtxhubHome(), 'events.jsonl');
}

// Appends an event envelope to the durable log. Fire-and-forget: a write failure
// must never kill the event publish flow. Errors are silently swallowed.
export async function appendEventLog(envelope: CtxhubEventEnvelope): Promise<void> {
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
    const typeSet = new Set(query.types);
    filtered = filtered.filter(e => typeSet.has(e.type));
  }

  return filtered.slice(0, query.limit ?? 100);
}
