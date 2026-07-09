import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { findConfigPath, initConfig, loadConfig, LOCAL_CONFIG_PATH, PROJECT_CONFIG_PATH, saveConfig } from './config.js';

async function withTempCwd(run: (cwd: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devctx-config-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('findConfigPath prefers devctx.yaml over .devctx/config.yaml', () => {
  return withTempCwd(async cwd => {
    await mkdir(path.join(cwd, '.devctx'), { recursive: true });
    await writeFile(path.join(cwd, PROJECT_CONFIG_PATH), 'version: 1\n');
    await writeFile(path.join(cwd, LOCAL_CONFIG_PATH), 'version: 1\n');

    const found = await findConfigPath(cwd);
    assert.equal(found, path.join(cwd, LOCAL_CONFIG_PATH));
  });
});

test('loadConfig merges a partial config over defaults', () => {
  return withTempCwd(async cwd => {
    await writeFile(
      path.join(cwd, LOCAL_CONFIG_PATH),
      yaml.dump({ workspace: { name: 'custom-ws' }, repositories: [{ name: 'app', path: './app' }] })
    );

    const config = await loadConfig(cwd);
    assert.equal(config.workspace.name, 'custom-ws');
    assert.equal(config.repositories.length, 1);
    assert.equal(config.memory.provider, 'mempalace');
    assert.equal(config.index.provider, 'lancedb');
  });
});

test('loadConfig merges partial hooks over the (empty) defaults', () => {
  return withTempCwd(async cwd => {
    await writeFile(
      path.join(cwd, LOCAL_CONFIG_PATH),
      yaml.dump({ hooks: { postPull: 'echo pulled' } })
    );

    const config = await loadConfig(cwd);
    assert.equal(config.hooks.postPull, 'echo pulled');
    assert.equal(config.hooks.postIndex, undefined);
  });
});

test('loadConfig throws a helpful error when no config exists', () => {
  return withTempCwd(async cwd => {
    await assert.rejects(() => loadConfig(cwd), /Run: devctx init/);
  });
});

test('initConfig creates the workspace directories and a project config', () => {
  return withTempCwd(async cwd => {
    await initConfig('my-ws', cwd);

    const configPath = await findConfigPath(cwd);
    assert.equal(configPath, path.join(cwd, PROJECT_CONFIG_PATH));

    const config = await loadConfig(cwd);
    assert.equal(config.workspace.name, 'my-ws');
  });
});

test('saveConfig writes back to whichever config path already exists', () => {
  return withTempCwd(async cwd => {
    await initConfig('my-ws', cwd);
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app' });
    await saveConfig(config, cwd);

    const reloaded = await loadConfig(cwd);
    assert.equal(reloaded.repositories.length, 1);
    assert.equal(reloaded.repositories[0].name, 'app');
  });
});
