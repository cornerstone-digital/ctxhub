import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { execa } from '../utils/execa-lite.js';
import { readText, pathExists } from '../utils/fs.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { repoDiscoverCommand, repoHookCommand, renderRepoGlobSuggestionDiff, suggestRepoGlobs } from './repo.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';

async function withGitRepoWorkspace(run: (cwd: string, repoPath: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-repohook-'));
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

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

test('repoHookCommand installs an executable post-commit hook', () => {
  return withGitRepoWorkspace(async (_cwd, repoPath) => {
    await repoHookCommand('app');

    const hookPath = path.join(repoPath, '.git', 'hooks', 'post-commit');
    assert.equal(await pathExists(hookPath), true);

    const contents = await readText(hookPath);
    assert.match(contents, /^#!\/bin\/sh/);
    assert.match(contents, /ctxhub repo hook app/);
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

test('repoDiscoverCommand summarizes discovered and already-configured repositories', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-repodiscover-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    await mkdir(path.join(cwd, 'repos'), { recursive: true });
    await execa('git', ['init', '-q', path.join(cwd, 'repos', 'app')]);

    process.chdir(cwd);
    const firstRun = await captureLog(() => repoDiscoverCommand('repos'));
    assert.ok(firstRun.some(line => line.includes('Discovered app -> repos/app')));
    assert.ok(firstRun.some(line => line.includes('Added 1 repository')));
    assert.ok(firstRun.some(line => line.includes('ctxhub index')));

    const secondRun = await captureLog(() => repoDiscoverCommand('repos'));
    assert.ok(secondRun.some(line => line.includes('No new repositories added')));
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('suggestRepoGlobs reports the disabled notice and no suggestion when llm.enabled is false', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-repoglobs-'));
  try {
    await mkdir(path.join(cwd, 'app', 'src'), { recursive: true });
    const result = await suggestRepoGlobs({ name: 'app', path: './app', git: true }, path.join(cwd, 'app'), config({ enabled: false }));
    assert.equal(result.suggestion, undefined);
    assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('suggestRepoGlobs parses structured include/exclude suggestions from the LLM response', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-repoglobs-'));
  try {
    await mkdir(path.join(cwd, 'app', 'src'), { recursive: true });
    const result = await suggestRepoGlobs(
      { name: 'app', path: './app', git: true },
      path.join(cwd, 'app'),
      config({ enabled: true }),
      async () => ({ ok: true, text: '{"include":["README.md","src/**/*.{ts,tsx}"],"exclude":["dist/**"],"rationale":["Small TypeScript repo."]}' })
    );

    assert.deepEqual(result.suggestion, {
      include: ['README.md', 'src/**/*.{ts,tsx}'],
      exclude: ['dist/**'],
      rationale: ['Small TypeScript repo.']
    });
    assert.equal(result.llmNotice, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('renderRepoGlobSuggestionDiff renders a repo-entry config diff without mutating config', () => {
  const diff = renderRepoGlobSuggestionDiff(
    { name: 'app', path: './app', git: true },
    { include: ['README.md'], exclude: ['dist/**'], rationale: [] }
  );

  assert.match(diff, /\+ {4}include:/);
  assert.match(diff, /\+ {6}- README\.md/);
  assert.match(diff, /\+ {4}exclude:/);
  assert.match(diff, /\+ {6}- dist\/\*\*/);
});
