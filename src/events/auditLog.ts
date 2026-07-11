import { getEventLogPath } from './eventLog.js';
import { pathExists, readText } from '../utils/fs.js';

export interface AuditLogFilter {
  actor?: string;       // sub or email substring match
  action?: string;      // event type substring match, e.g. "auth.login"
  from?: string;        // ISO date
  to?: string;          // ISO date
  limit?: number;       // default 100
  offset?: number;
}

export interface AuditLogEntry {
  ts: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Read and filter the audit event log (JSONL at ~/.ctxhub/events.jsonl).
 * Returns entries newest-first.
 */
export async function queryAuditLog(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
  const logPath = getEventLogPath();
  if (!(await pathExists(logPath))) return [];

  const raw = await readText(logPath);
  const lines = raw.split('\n').filter(l => l.trim());

  const entries: AuditLogEntry[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // Normalise: map `at` (eventBus envelope field) to `ts`
      const ts = (obj['at'] as string | undefined) ?? '';
      entries.push({ ...obj, ts, type: (obj['type'] as string) ?? 'unknown' });
    } catch {
      // Skip malformed lines
    }
  }

  // Newest-first
  entries.reverse();

  // Apply filters
  let filtered = entries;

  if (filter.actor) {
    const actor = filter.actor.toLowerCase();
    filtered = filtered.filter(e => {
      const sub = ((e['sub'] as string | undefined) ?? '').toLowerCase();
      const email = ((e['email'] as string | undefined) ?? '').toLowerCase();
      return sub.includes(actor) || email.includes(actor);
    });
  }

  if (filter.action) {
    const action = filter.action.toLowerCase();
    filtered = filtered.filter(e => e.type.toLowerCase().includes(action));
  }

  if (filter.from) {
    filtered = filtered.filter(e => e.ts >= filter.from!);
  }

  if (filter.to) {
    filtered = filtered.filter(e => e.ts <= filter.to!);
  }

  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 100;

  return filtered.slice(offset, offset + limit);
}

/**
 * Export audit log entries as JSON array string or CSV.
 */
export async function exportAuditLog(filter: AuditLogFilter, format: 'json' | 'csv'): Promise<string> {
  const entries = await queryAuditLog(filter);

  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  // CSV export
  const standardHeaders = ['ts', 'type', 'sub', 'email', 'action'];
  const extraKeys = new Set<string>();
  for (const entry of entries) {
    for (const key of Object.keys(entry)) {
      if (!standardHeaders.includes(key) && key !== 'id' && key !== 'at') {
        extraKeys.add(key);
      }
    }
  }

  const headers = [...standardHeaders, ...Array.from(extraKeys).sort()];

  const escape = (val: unknown): string => {
    const str = val === undefined || val === null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [
    headers.join(','),
    ...entries.map(entry => headers.map(h => escape(entry[h])).join(',')),
  ];

  return rows.join('\n');
}
