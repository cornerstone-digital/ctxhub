import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { runConfiguredHook } from './hooks.js';
import { pathExists, readText } from './fs.js';
import type { CtxhubConfig } from '../config/types.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-hooks-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeConfig(hooks: CtxhubConfig['hooks']): CtxhubConfig {
  return {
    version: 1,
    workspace: { name: 'ws' },
    repositories: [],
    knowledge: { include: [], exclude: [] },
    memory: { provider: 'local-json', path: '.ctxhub/memory' },
    index: { provider: 'local-json', path: '.ctxhub/index', table: 't', incremental: true, chunkSize: 100 },
    hooks,
    privacy: { redactPatterns: [] }
  };
}

test('runConfiguredHook does nothing when the hook is not configured', () => {
  return withTempDir(async dir => {
    await runConfiguredHook(makeConfig({}), 'postPull', dir);
  });
});

test('runConfiguredHook runs the configured shell command with workspace env vars', () => {
  return withTempDir(async dir => {
    const markerPath = path.join(dir, 'ran.txt');
    const config = makeConfig({ postIndex: `echo "$CTXHUB_EVENT:$CTXHUB_WORKSPACE" > "${markerPath}"` });

    await runConfiguredHook(config, 'postIndex', dir);

    assert.equal(await pathExists(markerPath), true);
    assert.equal((await readText(markerPath)).trim(), 'postIndex:ws');
  });
});

test('runConfiguredHook does not throw when the hook command fails', () => {
  return withTempDir(async dir => {
    const config = makeConfig({ postPull: 'exit 1' });
    await runConfiguredHook(config, 'postPull', dir);
  });
});
