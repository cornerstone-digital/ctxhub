import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { execa } from '../utils/execa-lite.js';
import { readText, pathExists } from '../utils/fs.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { repoHookCommand } from './repo.js';

async function withGitRepoWorkspace(run: (cwd: string, repoPath: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'devctx-repohook-'));
  try {
    await initConfig('ws', cwd);
    const repoPath = path.join(cwd, 'app');
    await execa('git', ['init', '-q', repoPath]);
    await execa('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repoPath });

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: true });
    await saveConfig(config, cwd);

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      await run(cwd, repoPath);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('repoHookCommand installs an executable post-commit hook', () => {
  return withGitRepoWorkspace(async (_cwd, repoPath) => {
    await repoHookCommand('app');

    const hookPath = path.join(repoPath, '.git', 'hooks', 'post-commit');
    assert.equal(await pathExists(hookPath), true);

    const contents = await readText(hookPath);
    assert.match(contents, /^#!\/bin\/sh/);
    assert.match(contents, /devctx repo hook app/);
    assert.match(contents, /index >\/dev\/null/);

    const stats = await stat(hookPath);
    assert.equal(stats.mode & 0o111, 0o111);
  });
});

test('repoHookCommand refuses to overwrite an existing hook without --force', () => {
  return withGitRepoWorkspace(async (_cwd, repoPath) => {
    await repoHookCommand('app');
    await assert.rejects(() => repoHookCommand('app'), /already exists/);

    await repoHookCommand('app', { force: true });
    const hookPath = path.join(repoPath, '.git', 'hooks', 'post-commit');
    assert.equal(await pathExists(hookPath), true);
  });
});

test('repoHookCommand errors for an unknown repo', () => {
  return withGitRepoWorkspace(async () => {
    await assert.rejects(() => repoHookCommand('missing'), /Repository not found/);
  });
});
