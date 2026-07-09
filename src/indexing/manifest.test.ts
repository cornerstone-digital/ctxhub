import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { loadManifest, manifestKey, saveManifest } from './manifest.js';

async function withTempCwd(run: (cwd: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ssd-manifest-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('manifestKey combines repo and file path', () => {
  assert.equal(manifestKey('app', 'docs/readme.md'), 'app:docs/readme.md');
});

test('loadManifest returns an empty manifest when none exists', () => {
  return withTempCwd(async cwd => {
    const manifest = await loadManifest('ws', cwd);
    assert.deepEqual(manifest, { version: 1, workspace: 'ws', files: {} });
  });
});

test('saveManifest then loadManifest round-trips entries', () => {
  return withTempCwd(async cwd => {
    const entry = {
      repo: 'app',
      filePath: 'README.md',
      absolutePath: path.join(cwd, 'app/README.md'),
      hash: 'abc123',
      indexedAt: new Date().toISOString(),
      chunkIds: ['chunk-1']
    };

    await saveManifest({ version: 1, workspace: 'ws', files: { 'app:README.md': entry } }, cwd);
    const reloaded = await loadManifest('ws', cwd);
    assert.deepEqual(reloaded.files['app:README.md'], entry);
  });
});
