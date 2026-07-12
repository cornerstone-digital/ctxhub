import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { sourceAddLandRegistryCommand, sourceListCommand } from './source.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-source-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test('sourceAddLandRegistryCommand requires --area and appends an evidenceSources entry', () => {
  return withWorkspace(async cwd => {
    await assert.rejects(() => sourceAddLandRegistryCommand('sw1a-sales', {}), /--area/);

    await sourceAddLandRegistryCommand('sw1a-sales', { area: 'sw1a', since: '2024-01-01' });
    const config = await loadConfig(cwd);
    assert.deepEqual(config.evidenceSources, [
      { kind: 'land-registry', name: 'sw1a-sales', postcodeArea: 'SW1A', sinceDate: '2024-01-01' }
    ]);
  });
});

test('sourceAddLandRegistryCommand rejects a duplicate name against either repositories or evidenceSources', () => {
  return withWorkspace(async cwd => {
    await sourceAddLandRegistryCommand('dup', { area: 'SW1A' });
    await assert.rejects(() => sourceAddLandRegistryCommand('dup', { area: 'SW1A' }), /already exists/);

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'repo-name', path: '.' });
    await saveConfig(config, cwd);
    await assert.rejects(() => sourceAddLandRegistryCommand('repo-name', { area: 'SW1A' }), /already exists/);
  });
});

test('sourceListCommand prints both repositories and evidence sources', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app' });
    await saveConfig(config, cwd);
    await sourceAddLandRegistryCommand('sw1a-sales', { area: 'SW1A' });

    const lines = await captureLog(() => sourceListCommand());
    assert.ok(lines.some(l => l.includes('app') && l.includes('git')));
    assert.ok(lines.some(l => l.includes('sw1a-sales') && l.includes('land-registry') && l.includes('SW1A')));
  });
});

test('sourceListCommand reports when nothing is configured', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => sourceListCommand());
    assert.ok(lines.some(l => l.includes('No evidence sources configured')));
  });
});
