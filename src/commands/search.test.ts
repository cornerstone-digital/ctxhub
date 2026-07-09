import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { searchCommand } from './search.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-search-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\n## Authentication flow\n\nAuth details live here.\n');

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await indexWorkspace(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
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

test('searchCommand prints ranked results for a one-shot query', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => searchCommand('authentication', {}));
    assert.ok(lines.some(line => line.includes('app')));
    assert.ok(lines.some(line => line.includes('README.md')));
  });
});

test('searchCommand throws a clear error with no query and no --interactive', () => {
  return withWorkspace(async () => {
    await assert.rejects(
      () => searchCommand(undefined, {}),
      /Provide a query, or pass --interactive/
    );
  });
});

test('searchCommand --interactive throws a clear error outside a real terminal instead of crashing', () => {
  return withWorkspace(async () => {
    assert.equal(process.stdin.isTTY, undefined, 'test runner stdin should not be a TTY');
    await assert.rejects(
      () => searchCommand('authentication', { interactive: true }),
      /--interactive needs a real terminal/
    );
  });
});
