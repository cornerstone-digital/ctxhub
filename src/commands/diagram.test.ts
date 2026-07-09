import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { diagramAddCommand } from './diagram.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { pathExists, readText } from '../utils/fs.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-diagram-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    await mkdir(path.join(cwd, 'app'), { recursive: true });

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

test('diagramAddCommand creates a dated Mermaid diagram under docs/architecture', () => {
  return withWorkspace(async cwd => {
    await diagramAddCommand('app', 'Runtime topology', { agent: 'codex' });

    const today = new Date().toISOString().slice(0, 10);
    const diagramPath = path.join(cwd, 'app', 'docs', 'architecture', `${today}-runtime-topology.mmd`);
    assert.equal(await pathExists(diagramPath), true);

    const content = await readText(diagramPath);
    assert.match(content, /%% title: Runtime topology/);
    assert.match(content, /%% agent: codex/);
    assert.match(content, /flowchart TD/);
  });
});

test('diagramAddCommand rejects an unknown repo and refuses overwrite', () => {
  return withWorkspace(async () => {
    await assert.rejects(() => diagramAddCommand('missing', 'Runtime topology'), /Repository not found: missing/);
    await diagramAddCommand('app', 'Runtime topology');
    await assert.rejects(() => diagramAddCommand('app', 'Runtime topology'), /already exists/);
  });
});
