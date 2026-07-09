import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { checkForDriftOnce } from './driftCheck.js';
import { getPackageVersion } from './version.js';
import { initConfig } from '../config/config.js';
import { skillsInstallCommand } from '../commands/skills.js';
import { pathExists, readText, writeText } from './fs.js';

const MARKER_PATH = path.join('.ctxhub', 'cache', 'last-checked-version');

async function withStaleWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-driftcheck-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    process.chdir(cwd);
    await skillsInstallCommand(['claude']);
    // Make the installed skill diverge from the shipped template so there's real drift to find.
    const skillPath = path.join(cwd, '.claude', 'skills', 'ctxhub', 'SKILL.md');
    await writeText(skillPath, `${await readText(skillPath)}\nstale edit\n`);

    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureStderr(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines;
}

test('checkForDriftOnce does nothing outside a ctxhub workspace', () => {
  return (async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-driftcheck-nowspace-'));
    const originalCwd = process.cwd();
    try {
      process.chdir(cwd);
      const lines = await captureStderr(() => checkForDriftOnce('search'));
      assert.deepEqual(lines, []);
      assert.equal(await pathExists(path.join(cwd, MARKER_PATH)), false);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  })();
});

test('checkForDriftOnce skips commands on the skip list without writing a marker', () => {
  return withStaleWorkspace(async cwd => {
    const lines = await captureStderr(() => checkForDriftOnce('mcp'));
    assert.deepEqual(lines, []);
    assert.equal(await pathExists(path.join(cwd, MARKER_PATH)), false);
  });
});

test('checkForDriftOnce warns once when drift is present, then stays quiet for the same version', () => {
  return withStaleWorkspace(async cwd => {
    const first = await captureStderr(() => checkForDriftOnce('search'));
    assert.equal(first.length, 1);
    assert.match(first[0], /ctxhub was upgraded/);
    assert.match(first[0], /1 installed skill\/config item/);

    const markerPath = path.join(cwd, MARKER_PATH);
    assert.equal(await pathExists(markerPath), true);
    assert.equal((await readText(markerPath)).trim(), getPackageVersion());

    const second = await captureStderr(() => checkForDriftOnce('search'));
    assert.deepEqual(second, []);
  });
});

test('checkForDriftOnce re-checks after the marker records a different version', () => {
  return withStaleWorkspace(async cwd => {
    await checkForDriftOnce('search');

    const markerPath = path.join(cwd, MARKER_PATH);
    await writeText(markerPath, '0.0.0-previous');

    const lines = await captureStderr(() => checkForDriftOnce('search'));
    assert.equal(lines.length, 1);
    assert.equal((await readText(markerPath)).trim(), getPackageVersion());
  });
});
