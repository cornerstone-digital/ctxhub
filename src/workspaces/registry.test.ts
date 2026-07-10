import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { initConfig } from '../config/config.js';
import { listWorkspaces, loadRegistry, registerWorkspace, removeWorkspace } from './registry.js';

async function withTempDir(prefix: string, run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withRegistryAndWorkspaces(run: (registryPath: string, makeWorkspace: (name: string) => Promise<string>) => Promise<void>) {
  return withTempDir('ctxhub-registry-', async registryDir => {
    const registryPath = path.join(registryDir, 'registry.json');
    const workspaces: string[] = [];

    try {
      await run(registryPath, async name => {
        const dir = await mkdtemp(path.join(os.tmpdir(), `ctxhub-registry-ws-${name}-`));
        workspaces.push(dir);
        await initConfig(name, dir);
        return dir;
      });
    } finally {
      await Promise.all(workspaces.map(dir => rm(dir, { recursive: true, force: true })));
    }
  });
}

test('loadRegistry returns an empty registry when no file exists yet', () => {
  return withTempDir('ctxhub-registry-missing-', async dir => {
    const registry = await loadRegistry(path.join(dir, 'registry.json'));
    assert.deepEqual(registry, { version: 1, workspaces: [] });
  });
});

test('registerWorkspace adds an entry using the workspace config\'s own name by default', () => {
  return withRegistryAndWorkspaces(async (registryPath, makeWorkspace) => {
    const dir = await makeWorkspace('alpha');

    const entry = await registerWorkspace(dir, undefined, registryPath);
    assert.equal(entry.name, 'alpha');
    assert.equal(path.resolve(entry.path), path.resolve(dir));
    assert.ok(entry.addedAt);

    const registry = await loadRegistry(registryPath);
    assert.equal(registry.workspaces.length, 1);
  });
});

test('registerWorkspace is idempotent for the same workspace path', () => {
  return withRegistryAndWorkspaces(async (registryPath, makeWorkspace) => {
    const dir = await makeWorkspace('alpha');

    const first = await registerWorkspace(dir, undefined, registryPath);
    const second = await registerWorkspace(dir, undefined, registryPath);
    assert.deepEqual(first, second);

    const registry = await loadRegistry(registryPath);
    assert.equal(registry.workspaces.length, 1);
  });
});

test('registerWorkspace rejects a duplicate name for a different path', () => {
  return withRegistryAndWorkspaces(async (registryPath, makeWorkspace) => {
    const first = await makeWorkspace('alpha');
    const second = await makeWorkspace('beta');

    await registerWorkspace(first, 'shared-name', registryPath);
    await assert.rejects(() => registerWorkspace(second, 'shared-name', registryPath), /already registered/);
  });
});

test('registerWorkspace accepts an explicit --name overriding the config default', () => {
  return withRegistryAndWorkspaces(async (registryPath, makeWorkspace) => {
    const dir = await makeWorkspace('alpha');

    const entry = await registerWorkspace(dir, 'custom-name', registryPath);
    assert.equal(entry.name, 'custom-name');
  });
});

test('listWorkspaces flags a workspace whose path no longer exists, without removing it', () => {
  return withRegistryAndWorkspaces(async (registryPath, makeWorkspace) => {
    const dir = await makeWorkspace('alpha');
    await registerWorkspace(dir, undefined, registryPath);
    await rm(dir, { recursive: true, force: true });

    const workspaces = await listWorkspaces(registryPath);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].exists, false);

    const registry = await loadRegistry(registryPath);
    assert.equal(registry.workspaces.length, 1, 'a missing path must not be silently pruned');
  });
});

test('removeWorkspace removes a registered entry by name and reports false when not found', () => {
  return withRegistryAndWorkspaces(async (registryPath, makeWorkspace) => {
    const dir = await makeWorkspace('alpha');
    await registerWorkspace(dir, undefined, registryPath);

    assert.equal(await removeWorkspace('not-registered', registryPath), false);
    assert.equal(await removeWorkspace('alpha', registryPath), true);

    const registry = await loadRegistry(registryPath);
    assert.equal(registry.workspaces.length, 0);
  });
});
