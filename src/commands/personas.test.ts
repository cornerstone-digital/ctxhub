import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { personasInitCommand, personasSyncCommand } from './personas.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { pathExists, readText } from '../utils/fs.js';

async function withTempCwd(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-personas-cmd-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await run(dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

async function withInitializedWorkspace(run: (dir: string) => Promise<void>) {
  return withTempCwd(async dir => {
    await initConfig('personas-ws', dir);
    await personasInitCommand();
    await run(dir);
  });
}

test('personasSyncCommand compiles a real native subagent file for Claude Code', () => {
  return withInitializedWorkspace(async dir => {
    await personasSyncCommand(['claude']);

    const content = await readText(path.join(dir, '.claude', 'agents', 'architect.md'));
    assert.match(content, /^---\nname: architect\ndescription: Protects long-term maintainability/);
    assert.match(content, /# Architect/);
    assert.ok(!content.includes('Compiled by'), 'the native format should not carry the fallback-file comment');
  });
});

test('personasSyncCommand compiles a real native subagent file for Codex CLI (TOML)', () => {
  return withInitializedWorkspace(async dir => {
    await personasSyncCommand(['codex']);

    const content = await readText(path.join(dir, '.codex', 'agents', 'architect.toml'));
    assert.match(content, /name = "architect"/);
    assert.match(content, /description = "Protects long-term maintainability/);
    assert.match(content, /developer_instructions = /);
    assert.match(content, /# Architect/);
  });
});

test('personasSyncCommand compiles a real native subagent file for GitHub Copilot CLI', () => {
  return withInitializedWorkspace(async dir => {
    await personasSyncCommand(['copilot']);

    const content = await readText(path.join(dir, '.github', 'agents', 'architect.agent.md'));
    assert.match(content, /^---\nname: architect\ndescription: Protects long-term maintainability/);
    assert.match(content, /# Architect/);
  });
});

test('personasSyncCommand compiles a real native subagent file for Cursor', () => {
  return withInitializedWorkspace(async dir => {
    await personasSyncCommand(['cursor']);

    const content = await readText(path.join(dir, '.cursor', 'agents', 'architect.md'));
    assert.match(content, /^---\nname: architect\ndescription: Protects long-term maintainability/);
    assert.match(content, /# Architect/);
  });
});

test('personasSyncCommand with no args compiles for every supported agent', () => {
  return withInitializedWorkspace(async dir => {
    await personasSyncCommand();

    assert.equal(await pathExists(path.join(dir, '.claude', 'agents', 'architect.md')), true);
    assert.equal(await pathExists(path.join(dir, '.codex', 'agents', 'architect.toml')), true);
    assert.equal(await pathExists(path.join(dir, '.github', 'agents', 'architect.agent.md')), true);
    assert.equal(await pathExists(path.join(dir, '.cursor', 'agents', 'architect.md')), true);
  });
});

test('personasSyncCommand writes to the workspace root and links configured child repos', () => {
  return withInitializedWorkspace(async dir => {
    const child = path.join(dir, 'app');
    await mkdir(child);
    const config = await loadConfig(dir);
    config.repositories.push({ name: 'app', path: './app', git: false });
    await saveConfig(config, dir);
    process.chdir(child);

    await personasSyncCommand(['claude']);

    const rootPath = path.join(dir, '.claude', 'agents', 'architect.md');
    const childPath = path.join(child, '.claude', 'agents', 'architect.md');
    assert.equal(await pathExists(rootPath), true);
    assert.equal(await pathExists(childPath), true);
    assert.equal((await lstat(childPath)).isSymbolicLink(), true);
    assert.equal(await readText(childPath), await readText(rootPath));
  });
});

test('personasSyncCommand rejects unsupported agent names before writing anything', () => {
  return withInitializedWorkspace(async dir => {
    await assert.rejects(() => personasSyncCommand(['claude', 'not-a-real-agent']), /Unsupported agent/);
    await assert.rejects(() => readText(path.join(dir, '.claude', 'agents', 'architect.md')));
  });
});

test('personasSyncCommand prints clear guidance and does nothing when no personas are configured', () => {
  return withTempCwd(async dir => {
    await initConfig('empty-ws', dir);

    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      await personasSyncCommand();
    } finally {
      console.log = original;
    }

    assert.ok(lines.some(line => line.includes('ctxhub personas init')));
    assert.equal(await pathExists(path.join(dir, '.claude')), false);
  });
});
