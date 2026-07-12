import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { demoCommand } from './demo.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { isGitRepo } from '../git/git.js';

async function withIsolatedHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-demo-cmd-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = home;
  try {
    await run(home);
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(home, { recursive: true, force: true });
  }
}

test('demoCommand indexes multiple chunks per file, not one chunk per file', () => {
  return withIsolatedHome(async home => {
    await demoCommand();

    const demoRoot = path.join(home, 'demo-workspace');
    const { config, workspaceRoot } = await loadWorkspaceConfig(demoRoot);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
    const chunks = await index.recent(10_000);

    // Regression: the summary line used to report indexWorkspace()'s file count
    // mislabeled as a chunk count. Files split into headed sections produce far
    // more than one chunk each, so this must be strictly greater than the file count.
    assert.ok(chunks.length > 6, `expected more than 6 chunks (one per file), got ${chunks.length}`);
  });
});

test('demoCommand initialises demo-docs as a git repo so `repo hook` works', () => {
  return withIsolatedHome(async home => {
    await demoCommand();

    const demoRoot = path.join(home, 'demo-workspace');
    assert.equal(await isGitRepo(demoRoot), true);
  });
});
