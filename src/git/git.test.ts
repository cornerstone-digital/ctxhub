import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execa } from '../utils/execa-lite.js';
import { getCurrentCommit, getRepoName, isGitInstalled, isGitRepo, pullRepo } from './git.js';

async function withTempRepo(run: (repoPath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ssd-git-'));
  try {
    await execa('git', ['init', '-q'], { cwd: dir });
    await execa('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('isGitInstalled reports true in this environment', async () => {
  assert.equal(await isGitInstalled(), true);
});

test('isGitRepo is true for a git repo and false for a plain directory', () => {
  return withTempRepo(async repoPath => {
    assert.equal(await isGitRepo(repoPath), true);

    const plainDir = await mkdtemp(path.join(os.tmpdir(), 'ssd-nongit-'));
    try {
      assert.equal(await isGitRepo(plainDir), false);
    } finally {
      await rm(plainDir, { recursive: true, force: true });
    }
  });
});

test('getCurrentCommit returns the HEAD sha', () => {
  return withTempRepo(async repoPath => {
    const commit = await getCurrentCommit(repoPath);
    assert.match(commit ?? '', /^[0-9a-f]{40}$/);
  });
});

test('getCurrentCommit returns undefined for a non-git path', async () => {
  const plainDir = await mkdtemp(path.join(os.tmpdir(), 'ssd-nongit-'));
  try {
    assert.equal(await getCurrentCommit(plainDir), undefined);
  } finally {
    await rm(plainDir, { recursive: true, force: true });
  }
});

test('getRepoName returns the final path segment', () => {
  assert.equal(getRepoName('/foo/bar/my-repo'), 'my-repo');
  assert.equal(getRepoName('./my-repo/'), 'my-repo');
});

test('pullRepo fails with a clear error when there is no upstream', () => {
  return withTempRepo(async repoPath => {
    await assert.rejects(() => pullRepo(repoPath), /failed with code/);
  });
});

test('pullRepo succeeds against a real remote', () => {
  return withTempRepo(async originPath => {
    await writeFile(path.join(originPath, 'file.txt'), 'hello');
    await execa('git', ['add', 'file.txt'], { cwd: originPath });
    await execa('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'add file'], { cwd: originPath });

    const clonePath = await mkdtemp(path.join(os.tmpdir(), 'ssd-clone-'));
    try {
      await execa('git', ['clone', '-q', originPath, clonePath]);
      await pullRepo(clonePath);
      assert.equal(await getCurrentCommit(clonePath), await getCurrentCommit(originPath));
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });
});
