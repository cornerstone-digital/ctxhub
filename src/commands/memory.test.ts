import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { memoryClearCommand } from './memory.js';
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
