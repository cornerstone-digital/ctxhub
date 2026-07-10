import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import {
  findConfigPath,
  initConfig,
  loadConfig,
  loadWorkspaceConfig,
  LOCAL_CONFIG_PATH,
  PROJECT_CONFIG_PATH,
  saveConfig,
  workspaceRootForConfig
} from './config.js';
import { defaultConfig } from './defaultConfig.js';

async function withTempCwd(run: (cwd: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-config-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('findConfigPath prefers ctxhub.yaml over .ctxhub/config.yaml', () => {
  return withTempCwd(async cwd => {
    await mkdir(path.join(cwd, '.ctxhub'), { recursive: true });
    await writeFile(path.join(cwd, PROJECT_CONFIG_PATH), 'version: 1\n');
    await writeFile(path.join(cwd, LOCAL_CONFIG_PATH), 'version: 1\n');

    const found = await findConfigPath(cwd);
    assert.equal(found, path.join(cwd, LOCAL_CONFIG_PATH));
  });
});

test('findConfigPath crawls upward from nested repository folders', () => {
  return withTempCwd(async cwd => {
    await writeFile(path.join(cwd, LOCAL_CONFIG_PATH), 'version: 1\n');
    const nested = path.join(cwd, 'repos', 'app', 'src');
    await mkdir(nested, { recursive: true });

    const found = await findConfigPath(nested);
    assert.equal(found, path.join(cwd, LOCAL_CONFIG_PATH));
  });
});

test('loadWorkspaceConfig returns the config path and workspace root', () => {
  return withTempCwd(async cwd => {
    await initConfig('my-ws', cwd);
    const nested = path.join(cwd, 'app');
    await mkdir(nested);

    const workspace = await loadWorkspaceConfig(nested);
    assert.equal(workspace.config.workspace.name, 'my-ws');
    assert.equal(workspace.configPath, path.join(cwd, PROJECT_CONFIG_PATH));
    assert.equal(workspace.workspaceRoot, cwd);
  });
});

test('workspaceRootForConfig treats ctxhub.yaml and .ctxhub/config.yaml as workspace configs', () => {
  const cwd = path.join(os.tmpdir(), 'ctxhub-config-root');
  assert.equal(workspaceRootForConfig(path.join(cwd, LOCAL_CONFIG_PATH)), cwd);
  assert.equal(workspaceRootForConfig(path.join(cwd, PROJECT_CONFIG_PATH)), cwd);
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

test('default knowledge globs do not treat YAML as indexable knowledge, and exclude cicd dirs', () => {
  // Regression guard: YAML in real repos is overwhelmingly CI/infra config (build
  // pipelines, k8s manifests) rather than narrative docs or app source, and CI
  // pipeline templates are frequently duplicated verbatim across repos in a
  // multi-repo workspace, which pollutes search results with identically-scored
  // boilerplate. See the cicd/cicd.yaml case observed indexing a real workspace.
  assert.ok(!defaultConfig.knowledge.include.some(pattern => pattern.includes('yaml') || pattern.includes('yml')));
  assert.ok(defaultConfig.knowledge.exclude.includes('**/cicd/**'));
});

test('loadConfig throws a helpful error when no config exists', () => {
  return withTempCwd(async cwd => {
    await assert.rejects(() => loadConfig(cwd), /Run: ctxhub init/);
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

test('initConfig does not overwrite a parent config when run from a nested folder', () => {
  return withTempCwd(async cwd => {
    await initConfig('parent', cwd);
    const nested = path.join(cwd, 'nested');
    await mkdir(nested);
    await initConfig('child', nested);

    assert.equal((await loadConfig(cwd)).workspace.name, 'parent');
    assert.equal((await loadConfig(nested)).workspace.name, 'child');
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
