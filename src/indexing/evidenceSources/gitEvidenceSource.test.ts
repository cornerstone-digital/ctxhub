import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { GitEvidenceSource } from './gitEvidenceSource.js';

async function withRepo(run: (workspaceRoot: string, repoPath: string) => Promise<void>) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-git-evidence-'));
  try {
    const repoPath = path.join(workspaceRoot, 'app');
    await mkdir(repoPath, { recursive: true });
    await run(workspaceRoot, repoPath);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('detect() reflects whether the configured repo path exists on disk', () => {
  return withRepo(async (workspaceRoot, repoPath) => {
    await writeFile(path.join(repoPath, 'a.md'), '# A\n');
    const present = new GitEvidenceSource({ name: 'app', path: './app', git: false }, workspaceRoot, [], [], [], 8);
    assert.equal(await present.detect(), true);

    const missing = new GitEvidenceSource({ name: 'gone', path: './does-not-exist', git: false }, workspaceRoot, [], [], [], 8);
    assert.equal(await missing.detect(), false);
  });
});

test('fetch() reports an accurate total up front and yields one Evidence per matched file', () => {
  return withRepo(async (workspaceRoot, repoPath) => {
    await writeFile(path.join(repoPath, 'a.md'), '# A\nHello A.\n');
    await writeFile(path.join(repoPath, 'b.md'), '# B\nHello B.\n');

    const source = new GitEvidenceSource({ name: 'app', path: './app', git: false }, workspaceRoot, ['**/*.md'], [], [], 8);
    const { total, items } = await source.fetch();
    assert.equal(total, 2);

    const collected = [];
    for await (const item of items) collected.push(item);
    assert.equal(collected.length, 2);
    assert.deepEqual(collected.map(e => e.sourceId).sort(), ['a.md', 'b.md']);
    assert.equal(collected.find(e => e.sourceId === 'a.md')?.content.includes('Hello A'), true);
  });
});

test('an oversized file is marked unreadable rather than dropped silently', () => {
  return withRepo(async (workspaceRoot, repoPath) => {
    const big = 'x'.repeat(11 * 1024 * 1024); // over the 10MB guard
    await writeFile(path.join(repoPath, 'huge.md'), big);
    await writeFile(path.join(repoPath, 'small.md'), '# small\n');

    const source = new GitEvidenceSource({ name: 'app', path: './app', git: false }, workspaceRoot, ['**/*.md'], [], [], 8);
    const { total, items } = await source.fetch();
    assert.equal(total, 2);

    const collected = [];
    for await (const item of items) collected.push(item);

    const huge = collected.find(e => e.sourceId === 'huge.md');
    assert.ok(huge?.unreadable, 'expected the oversized file to be marked unreadable');
    const small = collected.find(e => e.sourceId === 'small.md');
    assert.equal(small?.unreadable, undefined);
  });
});
