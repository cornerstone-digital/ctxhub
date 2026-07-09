import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { noteAddCommand } from './note.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { readText, pathExists } from '../utils/fs.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-note-'));
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

test('noteAddCommand creates a dated, slugified note file under <repo>/agent-notes/', () => {
  return withWorkspace(async cwd => {
    await noteAddCommand('app', 'Why we switched the MCP transport', { agent: 'claude' });

    const today = new Date().toISOString().slice(0, 10);
    const notePath = path.join(cwd, 'app', 'agent-notes', `${today}-why-we-switched-the-mcp-transport.md`);
    assert.equal(await pathExists(notePath), true);

    const content = await readText(notePath);
    assert.match(content, /^---\nagent: claude\ndate: \d{4}-\d{2}-\d{2}\n---/);
    assert.match(content, /# Why we switched the MCP transport/);
    assert.match(content, /MemPalace/);
  });
});

test('noteAddCommand defaults the agent field when not provided', () => {
  return withWorkspace(async cwd => {
    await noteAddCommand('app', 'Untitled finding');

    const today = new Date().toISOString().slice(0, 10);
    const content = await readText(path.join(cwd, 'app', 'agent-notes', `${today}-untitled-finding.md`));
    assert.match(content, /^---\nagent: unknown\n/);
  });
});

test('noteAddCommand rejects an unknown repo', () => {
  return withWorkspace(async () => {
    await assert.rejects(() => noteAddCommand('not-a-repo', 'Some title'), /Repository not found: not-a-repo/);
  });
});

test('noteAddCommand refuses to overwrite an existing note with the same title and date', () => {
  return withWorkspace(async () => {
    await noteAddCommand('app', 'Duplicate title');
    await assert.rejects(() => noteAddCommand('app', 'Duplicate title'), /already exists/);
  });
});
