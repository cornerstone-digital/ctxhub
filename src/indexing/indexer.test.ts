import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { indexWorkspace, type IndexProgressEvent } from './indexer.js';
import { createIndexProvider } from './providers.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-indexer-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, 'thing.ts'),
      ['export function computeTotal(items: number[]) {', '  return items.reduce((a, b) => a + b, 0);', '}'].join('\n')
    );

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

test('indexWorkspace reports repo-start/repo-progress/repo-done/repo-missing progress events in order', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'gone', path: './does-not-exist', git: false });
    await saveConfig(config, cwd);

    const events: IndexProgressEvent[] = [];
    await indexWorkspace(cwd, false, event => events.push(event));

    assert.deepEqual(events[0], { type: 'repo-start', repo: 'app' });
    assert.deepEqual(events[1], { type: 'repo-progress', repo: 'app', scanned: 0, total: 1 });
    assert.deepEqual(events[2], { type: 'repo-done', repo: 'app', scanned: 1, indexed: 1, skipped: 0 });
    assert.deepEqual(events[3], { type: 'repo-missing', repo: 'gone' });
  });
});

test('indexWorkspace emits repo-progress events with the correct file counts, throttled by time', () => {
  return withWorkspace(async cwd => {
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(cwd, 'app', `extra-${i}.md`), `# Extra ${i}\n`);
    }

    const events: IndexProgressEvent[] = [];
    await indexWorkspace(cwd, false, event => events.push(event));

    const progressEvents = events.filter((event): event is Extract<IndexProgressEvent, { type: 'repo-progress' }> => event.type === 'repo-progress');
    assert.ok(progressEvents.length >= 1, 'expects at least the initial repo-progress event');
    assert.deepEqual(progressEvents[0], { type: 'repo-progress', repo: 'app', scanned: 0, total: 6 });
    for (const event of progressEvents) {
      assert.equal(event.total, 6);
      assert.ok(event.scanned >= 0 && event.scanned <= 6);
    }
  });
});

test('indexWorkspace never loses a write despite concurrent prepare, even against a non-locking index provider', () => {
  // local-json's provider does a naive whole-file read-mutate-write with no locking (see
  // LocalJsonIndex.ts) -- if indexWorkspace's parallel "prepare" phase ever let two files'
  // actual index writes (indexDocuments/removeDocuments) overlap, this provider would silently
  // lose one of them (last writer wins). This test proves the commit phase really does stay
  // serialized: enough files that the default concurrency=8 batches genuinely overlap in
  // prepare, then assert every single one still made it into the index.
  return withWorkspace(async cwd => {
    const fileCount = 24;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(path.join(cwd, 'app', `doc-${i}.md`), `# Doc ${i}\n\nUnique marker doc-marker-${i}.\n`);
    }

    const result = await indexWorkspace(cwd);
    // +1 for the original thing.ts from withWorkspace's fixture.
    assert.equal(result.indexed, fileCount + 1);

    const config = await loadConfig(cwd);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
    for (let i = 0; i < fileCount; i++) {
      const results = await index.search(`doc-marker-${i}`, 5);
      assert.ok(results.some(r => r.content.includes(`doc-marker-${i}`)), `doc-${i}.md's write was lost`);
    }
  });
});

test('indexWorkspace tags source-code chunks with symbol metadata that search results carry through', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);

    const config = await loadConfig(cwd);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
    const results = await index.search('computeTotal', 5);

    assert.ok(results.length > 0);
    assert.equal(results[0].symbol, 'computeTotal');
    assert.equal(results[0].symbolKind, 'function');
  });
});

test('indexWorkspace indexes a non-git evidence source (ADR-020) alongside git repositories, as unverified evidence', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.evidenceSources = [{ kind: 'land-registry', name: 'sw1a-sales', postcodeArea: 'SW1A', sinceDate: '2020-01-01' }];
    await saveConfig(config, cwd);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') return { ok: true, status: 200 } as Response;
      const csv = '"{TXN-1}","360000","2025-06-01 00:00","SW1A 1AA","F","N","L","81","","SALISBURY ROAD","","LONDON","WESTMINSTER","GREATER LONDON","A","A"';
      return { ok: true, status: 200, text: async () => csv } as Response;
    }) as typeof globalThis.fetch;

    try {
      const result = await indexWorkspace(cwd);
      // +1 for the git fixture's thing.ts, +1 for the one Land Registry transaction.
      assert.equal(result.indexed, 2);

      const updatedConfig = await loadConfig(cwd);
      const index = createIndexProvider(updatedConfig.index.provider, updatedConfig.index.path, updatedConfig.index.table, cwd);
      const results = await index.search('Salisbury Road', 5);
      assert.ok(results.some(r => r.repo === 'sw1a-sales' && r.trustTier === 'unverified'), 'expected the Land Registry transaction to be indexed as unverified evidence');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
