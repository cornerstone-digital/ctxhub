import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { loadBlueprintStore, findInstalled } from '../blueprints/store.js';
import { blueprintListCommand } from './blueprint.js';

// ── loadBlueprintStore ────────────────────────────────────────────────────────

describe('loadBlueprintStore', () => {
  test('returns empty store when file does not exist', async () => {
    // Point CTXHUB_HOME at a fresh temp dir with no blueprints.json
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-blueprint-test-'));
    const originalHome = process.env['CTXHUB_HOME'];
    try {
      process.env['CTXHUB_HOME'] = tmpDir;
      const store = await loadBlueprintStore();
      assert.equal(store.version, 1);
      assert.deepEqual(store.installed, []);
    } finally {
      if (originalHome === undefined) {
        delete process.env['CTXHUB_HOME'];
      } else {
        process.env['CTXHUB_HOME'] = originalHome;
      }
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── findInstalled ─────────────────────────────────────────────────────────────

describe('findInstalled', () => {
  test('returns undefined when blueprint is not in the store', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-blueprint-test-'));
    const originalHome = process.env['CTXHUB_HOME'];
    try {
      process.env['CTXHUB_HOME'] = tmpDir;
      const result = await findInstalled('nonexistent-blueprint');
      assert.equal(result, undefined);
    } finally {
      if (originalHome === undefined) {
        delete process.env['CTXHUB_HOME'];
      } else {
        process.env['CTXHUB_HOME'] = originalHome;
      }
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── blueprintListCommand ──────────────────────────────────────────────────────

describe('blueprintListCommand', () => {
  test('prints empty state message when no blueprints are installed', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-blueprint-test-'));
    const originalHome = process.env['CTXHUB_HOME'];

    const logs: string[] = [];
    const origLog = console.log;

    try {
      process.env['CTXHUB_HOME'] = tmpDir;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await blueprintListCommand();

      const combined = logs.join('\n');
      assert.ok(
        combined.includes('No blueprints installed'),
        `Expected "No blueprints installed" in output, got: ${combined}`
      );
    } finally {
      console.log = origLog;
      if (originalHome === undefined) {
        delete process.env['CTXHUB_HOME'];
      } else {
        process.env['CTXHUB_HOME'] = originalHome;
      }
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
