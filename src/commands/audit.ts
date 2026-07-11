import { writeFile } from 'node:fs/promises';
import { queryAuditLog, exportAuditLog, type AuditLogFilter } from '../events/auditLog.js';

export interface AuditCommandOptions {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: string;
  format?: string;
  out?: string;
}

export async function auditCommand(opts: AuditCommandOptions): Promise<void> {
  const format = (opts.format ?? 'table') as 'table' | 'json' | 'csv';
  const limit = parseInt(opts.limit ?? '20', 10);

  const filter: AuditLogFilter = {
    actor: opts.actor,
    action: opts.action,
    from: opts.from,
    to: opts.to,
    limit: format === 'table' ? limit : undefined, // for raw formats, apply limit after
  };

  if (format === 'json' || format === 'csv') {
    const output = await exportAuditLog(filter, format);
    if (opts.out) {
      await writeFile(opts.out, output, 'utf8');
      console.log(`✓ Wrote ${format.toUpperCase()} to ${opts.out}`);
    } else {
      console.log(output);
    }
    return;
  }

  // Table format
  const entries = await queryAuditLog(filter);

  if (entries.length === 0) {
    console.log('No audit events found.');
    return;
  }

  console.log('');
  console.log('Timestamp                  Type                              Actor');
  console.log('-'.repeat(90));

  for (const entry of entries) {
    const ts = (entry.ts || entry['at'] || '').toString().substring(0, 24).padEnd(26);
    const type = entry.type.substring(0, 34).padEnd(34);
    const sub = ((entry['sub'] as string | undefined) ?? '').substring(0, 24);
    const email = ((entry['email'] as string | undefined) ?? '');
    const actor = sub || email || '-';
    console.log(`${ts} ${type} ${actor}`);
  }

  console.log('');
  console.log(`${entries.length} event(s) shown.`);
  if (opts.out) {
    // If --out is specified with table format, write formatted output to file
    const lines = [
      'Timestamp                  Type                              Actor',
      '-'.repeat(90),
      ...entries.map(entry => {
        const ts = (entry.ts || entry['at'] || '').toString().substring(0, 24).padEnd(26);
        const type = entry.type.substring(0, 34).padEnd(34);
        const sub = ((entry['sub'] as string | undefined) ?? '').substring(0, 24);
        const email = ((entry['email'] as string | undefined) ?? '');
        const actor = sub || email || '-';
        return `${ts} ${type} ${actor}`;
      }),
      '',
      `${entries.length} event(s) shown.`,
    ];
    await writeFile(opts.out, lines.join('\n'), 'utf8');
    console.log(`✓ Wrote to ${opts.out}`);
  }
}
