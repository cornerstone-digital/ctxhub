import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { memoryAddCommand, memoryCheckpointCommand, memoryClearCommand, memoryDiaryCommand, memorySearchCommand, memoryStatusCommand, memoryTimelineCommand, suggestMemoryLocation } from './memory.js';
import { runGit } from '../git/git.js';
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

test('memoryAddCommand stores durable memory under an explicit wing and room', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memoryAddCommand(
      'Remember the GraphQL migration rationale.',
      { wing: 'app', room: 'decisions', addedBy: 'copilot' },
      { addDrawerMempalaceFn: async () => ({ success: true, drawer_id: 'drawer-123', wing: 'app', room: 'decisions' }) }
    ));

    assert.ok(lines.some(line => line.includes('Stored durable memory in app / decisions')));
    assert.ok(lines.some(line => line.includes('drawer-123')));
  });
});

test('memoryAddCommand auto-suggests a wing/room from existing rooms when neither is given (NEXT_FEATURES #26)', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memoryAddCommand(
      'Auth token rotation decision for the login flow.',
      {},
      {
        readMempalaceStatusSummaryFn: async () => ({
          available: true,
          items: [
            { wing: 'app', room: 'auth-decisions', count: 3 },
            { wing: 'app', room: 'billing', count: 1 }
          ]
        }),
        addDrawerMempalaceFn: async () => ({ success: true, drawer_id: 'drawer-9' })
      }
    ));

    // "auth" overlaps with the existing "auth-decisions" room's keywords, so that should win over
    // "billing", which shares nothing with the content.
    assert.ok(lines.some(line => line.includes('Stored durable memory in app / auth-decisions')));
    assert.ok(lines.some(line => line.includes('auto-suggested')));
  });
});

test('memoryAddCommand still honors an explicitly given wing/room over auto-suggestion', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memoryAddCommand(
      'Auth token rotation decision.',
      { wing: 'app', room: 'decisions' },
      { addDrawerMempalaceFn: async () => ({ success: true, drawer_id: 'drawer-9' }) }
    ));

    assert.ok(lines.some(line => line.includes('Stored durable memory in app / decisions')));
    assert.ok(!lines.some(line => line.includes('auto-suggested')));
  });
});

test('suggestMemoryLocation picks the room with the most keyword overlap, falling back to a "notes" room in the caller\'s own wing', () => {
  const rooms = [
    { wing: 'app', room: 'auth-decisions', count: 3 },
    { wing: 'app', room: 'billing', count: 1 }
  ];

  assert.deepEqual(suggestMemoryLocation('auth token rotation', rooms, 'app'), { wing: 'app', room: 'auth-decisions' });
  assert.deepEqual(suggestMemoryLocation('completely unrelated content', rooms, 'app'), { wing: 'app', room: 'notes' });
  assert.deepEqual(suggestMemoryLocation('anything', [], 'billing'), { wing: 'billing', room: 'notes' });
});

test('memoryCheckpointCommand assembles a diary entry from the current git branch/commits plus an optional note', () => {
  return withWorkspace(async cwd => {
    await runGit(['init'], cwd);
    await runGit(['config', 'user.email', 'test@example.com'], cwd);
    await runGit(['config', 'user.name', 'Test'], cwd);
    await writeFile(path.join(cwd, 'file.txt'), 'hello');
    await runGit(['add', '.'], cwd);
    await runGit(['commit', '-m', 'initial commit'], cwd);

    let capturedEntry = '';
    const lines = await captureLog(() => memoryCheckpointCommand(
      'Finished wiring the auth flow.',
      { agent: 'claude' },
      {
        writeDiaryMempalaceFn: async (_config, _workspaceRoot, input) => {
          capturedEntry = input.entry;
          return { success: true, entry_id: 'diary-42' };
        }
      }
    ));

    assert.match(capturedEntry, /Finished wiring the auth flow\./);
    assert.match(capturedEntry, /Branch: /);
    assert.match(capturedEntry, /Recent commits:\n- .*initial commit/);
    assert.ok(lines.some(line => line.includes('Saved session checkpoint for claude')));
    assert.ok(lines.some(line => line.includes('diary-42')));
  });
});

test('memoryCheckpointCommand still saves a checkpoint outside a git repo, with a plain note-only entry', () => {
  return withWorkspace(async () => {
    let capturedEntry = '';
    await captureLog(() => memoryCheckpointCommand(
      undefined,
      { agent: 'claude' },
      {
        writeDiaryMempalaceFn: async (_config, _workspaceRoot, input) => {
          capturedEntry = input.entry;
          return { success: true };
        }
      }
    ));

    assert.match(capturedEntry, /no note or git context available/);
  });
});

test('memoryDiaryCommand stores a diary entry for an agent', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => memoryDiaryCommand(
      'Worked through the auth migration and captured the key gotchas.',
      { agent: 'copilot', topic: 'auth-migration', wing: 'app' },
      { writeDiaryMempalaceFn: async () => ({ success: true, entry_id: 'diary-123', topic: 'auth-migration' }) }
    ));

    assert.ok(lines.some(line => line.includes('Stored diary entry for copilot')));
    assert.ok(lines.some(line => line.includes('Wing: app')));
    assert.ok(lines.some(line => line.includes('diary-123')));
  });
});
