import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkServerStaleness } from './serverStatus.js';

test('checkServerStaleness reports dev mode (no dist in the entry path) as never stale', () => {
  const status = checkServerStaleness(Date.now(), '/some/project/src/index.ts');
  assert.equal(status.mode, 'dev');
  assert.equal(status.stale, false);
  assert.match(status.instructions, /dev mode/);
  assert.equal(status.builtAt, undefined);
});

test('checkServerStaleness reports stale when the installed entry file was rebuilt after the process started', () => {
  const startedAt = Date.parse('2026-07-10T00:00:00.000Z');
  const rebuiltAt = Date.parse('2026-07-10T01:00:00.000Z');
  const status = checkServerStaleness(startedAt, '/proj/dist/index.js', () => ({ mtimeMs: rebuiltAt }));

  assert.equal(status.mode, 'installed');
  assert.equal(status.stale, true);
  assert.equal(status.builtAt, new Date(rebuiltAt).toISOString());
  assert.match(status.instructions, /ask them to restart/i);
});

test('checkServerStaleness reports not stale when the entry file predates process start', () => {
  const startedAt = Date.parse('2026-07-10T01:00:00.000Z');
  const builtAt = Date.parse('2026-07-10T00:00:00.000Z');
  const status = checkServerStaleness(startedAt, '/proj/dist/index.js', () => ({ mtimeMs: builtAt }));

  assert.equal(status.mode, 'installed');
  assert.equal(status.stale, false);
  assert.match(status.instructions, /no action needed/i);
});

test('checkServerStaleness handles an unreadable entry file without throwing', () => {
  const status = checkServerStaleness(Date.now(), '/proj/dist/index.js', () => {
    throw new Error('ENOENT');
  });

  assert.equal(status.mode, 'installed');
  assert.equal(status.stale, false);
  assert.match(status.instructions, /could not/i);
});

test('checkServerStaleness always includes the current package version', () => {
  const status = checkServerStaleness(Date.now(), '/some/project/src/index.ts');
  assert.equal(typeof status.version, 'string');
  assert.ok(status.version.length > 0);
});
