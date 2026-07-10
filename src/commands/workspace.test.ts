import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { initConfig } from '../config/config.js';
import { getRegistryPath, loadRegistry } from '../workspaces/registry.js';
import { workspaceListCommand, workspaceRegisterCommand, workspaceRemoveCommand } from './workspace.js';

async function withIsolatedRegistry(run: (workspaceDir: string) => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-home-'));
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-workspace-cmd-'));
  const originalHome = process.env.CTXHUB_HOME;
  const originalCwd = process.cwd();
  process.env.CTXHUB_HOME = ctxhubHome;

  try {
    await initConfig('cmd-ws', workspaceDir);
    process.chdir(workspaceDir);
    await run(workspaceDir);
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = originalHome;
    await rm(ctxhubHome, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  return { lines, restore: () => { console.log = original; } };
}

test('workspaceRegisterCommand registers the discovered workspace root', () => {
  return withIsolatedRegistry(async workspaceDir => {
    const capture = captureConsole();
    try {
      await workspaceRegisterCommand('.', {});
    } finally {
      capture.restore();
    }

    assert.ok(capture.lines.some(line => line.includes('Registered workspace "cmd-ws"')));

    const registry = await loadRegistry(getRegistryPath());
    assert.equal(registry.workspaces.length, 1);
    // macOS resolves the tmpdir symlink (/var -> /private/var) once we `process.chdir` into it,
    // so compare against the realpath rather than mkdtemp's own unresolved path.
    assert.equal(path.resolve(registry.workspaces[0].path), await realpath(workspaceDir));
  });
});

test('workspaceListCommand reports no workspaces registered, then lists a registered one', () => {
  return withIsolatedRegistry(async () => {
    const before = captureConsole();
    try {
      await workspaceListCommand();
    } finally {
      before.restore();
    }
    assert.ok(before.lines.some(line => line.includes('No workspaces registered')));

    await workspaceRegisterCommand('.', {});

    const after = captureConsole();
    try {
      await workspaceListCommand();
    } finally {
      after.restore();
    }
    assert.ok(after.lines.some(line => line.includes('cmd-ws')));
  });
});

test('workspaceRemoveCommand removes a registered workspace and reports the unknown-name case', () => {
  return withIsolatedRegistry(async () => {
    await workspaceRegisterCommand('.', {});

    const unknown = captureConsole();
    try {
      await workspaceRemoveCommand('not-registered');
    } finally {
      unknown.restore();
    }
    assert.ok(unknown.lines.some(line => line.includes('No registered workspace named')));

    const removed = captureConsole();
    try {
      await workspaceRemoveCommand('cmd-ws');
    } finally {
      removed.restore();
    }
    assert.ok(removed.lines.some(line => line.includes('Removed workspace "cmd-ws"')));

    const registry = await loadRegistry(getRegistryPath());
    assert.equal(registry.workspaces.length, 0);
  });
});
