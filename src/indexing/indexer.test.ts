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
