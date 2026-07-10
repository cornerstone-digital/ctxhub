import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { memoryClearCommand, memorySearchCommand, memoryStatusCommand, memoryTimelineCommand } from './memory.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { loadManifest } from '../indexing/manifest.js';
import { createIndexProvider } from '../indexing/providers.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-memory-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\n## Setup\n\nHow to set this up.\n');

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    config.memory.provider = 'local-json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test('memoryClearCommand resets the manifest so a subsequent index actually rebuilds', () => {
  return withWorkspace(async cwd => {
    const first = await indexWorkspace(cwd);
    assert.equal(first.indexed, 1);

    const config = await loadConfig(cwd);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
    assert.equal((await index.status()).chunkCount > 0, true);

    await memoryClearCommand({ force: true });

    assert.equal((await index.status()).chunkCount, 0);

    const manifestAfterClear = await loadManifest(config.workspace.name, cwd);
    assert.deepEqual(manifestAfterClear.files, {});

    // This is the regression this test guards: before the fix, the stale manifest
    // made this second index() call report "skipped" instead of actually rebuilding,
    // leaving the index empty even though the files are unchanged and search should work.
    const second = await indexWorkspace(cwd);
    assert.equal(second.indexed, 1);
    assert.equal(second.skipped, 0);
    assert.equal((await index.status()).chunkCount > 0, true);
  });
});

test('memoryStatusCommand includes MemPalace wing/room summaries when available', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memoryStatusCommand(
      { plain: true },
      { readMempalaceStatusSummaryFn: async () => ({ available: true, note: '7 drawers across 2 room(s)', totalDrawers: 7, items: [{ wing: 'app', room: 'decisions', count: 2 }, { wing: 'app', room: 'auth', count: 5 }] }) }
    ));

    assert.ok(lines.some(line => line.includes('MemPalace:')));
    assert.ok(lines.some(line => line.includes('app / decisions (2 drawers)')));
    assert.ok(lines.some(line => line.includes('app / auth (5 drawers)')));
  });
});

test('memorySearchCommand prints MemPalace results scoped by wing and room', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memorySearchCommand(
      'why graphql',
      { wing: 'app', room: 'decisions' },
      {
        searchMempalaceFn: async () => ({
          query: 'why graphql',
          filters: { wing: 'app', room: 'decisions' },
          results: [{ wing: 'app', room: 'decisions', source_file: 'notes.md', similarity: 0.91, text: 'We switched to GraphQL for schema evolution.' }]
        })
      }
    ));

    assert.ok(lines.some(line => line.includes('MemPalace search: why graphql')));
    assert.ok(lines.some(line => line.includes('Wing: app')));
    assert.ok(lines.some(line => line.includes('Room: decisions')));
    assert.ok(lines.some(line => line.includes('We switched to GraphQL')));
  });
});

test('memoryTimelineCommand prints timeline events from MemPalace', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memoryTimelineCommand(
      'graphql',
      {},
      { timelineMempalaceFn: async () => ({ entity: 'graphql', count: 1, timeline: [{ subject: 'api', predicate: 'uses', object: 'graphql', valid_from: '2026-01-01' }] }) }
    ));

    assert.ok(lines.some(line => line.includes('MemPalace timeline: graphql')));
    assert.ok(lines.some(line => line.includes('1 event(s)')));
    assert.ok(lines.some(line => line.includes('"predicate": "uses"')));
  });
});
