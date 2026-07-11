/**
 * Tests for the audit log query/export functions.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryAuditLog, exportAuditLog } from './auditLog.js';

// Helper to write test log entries
async function writeTestLog(dir: string, entries: object[]): Promise<void> {
  const logPath = join(dir, 'events.jsonl');
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(logPath, lines, 'utf8');
}

describe('queryAuditLog', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ctxhub-audit-test-'));
    originalHome = process.env['CTXHUB_HOME'];
    process.env['CTXHUB_HOME'] = tmpDir;
  });

  after(async () => {
    if (originalHome !== undefined) {
      process.env['CTXHUB_HOME'] = originalHome;
    } else {
      delete process.env['CTXHUB_HOME'];
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when log file does not exist', async () => {
    const result = await queryAuditLog();
    assert.deepEqual(result, []);
  });

  it('returns all entries when no filter is applied', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'user1', email: 'a@b.com' },
      { id: 'evt-2', at: '2024-01-01T11:00:00Z', type: 'auth.logout', sub: 'user1', email: 'a@b.com' },
    ]);

    const result = await queryAuditLog();
    assert.equal(result.length, 2);
  });

  it('filters by action type substring', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'user1', email: 'a@b.com' },
      { id: 'evt-2', at: '2024-01-01T11:00:00Z', type: 'index.started', workspace: 'ws1' },
      { id: 'evt-3', at: '2024-01-01T12:00:00Z', type: 'auth.logout', sub: 'user1', email: 'a@b.com' },
    ]);

    const result = await queryAuditLog({ action: 'auth.login' });
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'auth.login');
  });

  it('returns entries newest-first', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'u1' },
      { id: 'evt-2', at: '2024-01-02T10:00:00Z', type: 'auth.logout', sub: 'u1' },
    ]);

    const result = await queryAuditLog();
    assert.ok(result[0].ts >= result[1].ts, 'first entry should be newest');
  });

  it('filters by actor substring', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'aad-123', email: 'alice@example.com' },
      { id: 'evt-2', at: '2024-01-01T11:00:00Z', type: 'auth.login', sub: 'aad-456', email: 'bob@example.com' },
    ]);

    const result = await queryAuditLog({ actor: 'alice' });
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'auth.login');
  });

  it('respects limit', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'u1' },
      { id: 'evt-2', at: '2024-01-01T11:00:00Z', type: 'auth.logout', sub: 'u1' },
      { id: 'evt-3', at: '2024-01-01T12:00:00Z', type: 'auth.login', sub: 'u2' },
    ]);

    const result = await queryAuditLog({ limit: 2 });
    assert.equal(result.length, 2);
  });
});

describe('exportAuditLog', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ctxhub-audit-export-test-'));
    originalHome = process.env['CTXHUB_HOME'];
    process.env['CTXHUB_HOME'] = tmpDir;
  });

  after(async () => {
    if (originalHome !== undefined) {
      process.env['CTXHUB_HOME'] = originalHome;
    } else {
      delete process.env['CTXHUB_HOME'];
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('produces valid CSV with header row', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'aad-123', email: 'alice@example.com' },
    ]);

    const csv = await exportAuditLog({}, 'csv');
    const lines = csv.split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 1, 'CSV should have at least a header row');
    const header = lines[0];
    assert.ok(header.includes('ts'), 'header should include ts');
    assert.ok(header.includes('type'), 'header should include type');
  });

  it('CSV has data rows after header', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'aad-123', email: 'alice@example.com' },
      { id: 'evt-2', at: '2024-01-01T11:00:00Z', type: 'auth.logout', sub: 'aad-123', email: 'alice@example.com' },
    ]);

    const csv = await exportAuditLog({}, 'csv');
    const lines = csv.split('\n').filter(l => l.trim());
    // header + 2 data rows
    assert.ok(lines.length >= 3, `expected at least 3 lines, got ${lines.length}`);
  });

  it('JSON format returns valid JSON array', async () => {
    await writeTestLog(tmpDir, [
      { id: 'evt-1', at: '2024-01-01T10:00:00Z', type: 'auth.login', sub: 'u1' },
    ]);

    const json = await exportAuditLog({}, 'json');
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed), 'JSON output should be an array');
    assert.equal(parsed.length, 1);
  });
});
