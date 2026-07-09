import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { doctorCommand } from './doctor.js';
import { skillsInstallCommand } from './skills.js';
import { agentLaunchCommand } from './agent.js';
import { initConfig } from '../config/config.js';
import { readText, writeText } from '../utils/fs.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-doctor-'));
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

async function captureDoctorOutput(): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await doctorCommand();
  } finally {
    console.log = original;
  }
  return lines;
}

test('doctorCommand reports the config schema version as up to date for a fresh config', () => {
  return withWorkspace(async () => {
    const lines = await captureDoctorOutput();
    assert.ok(lines.some(line => line.includes('Config schema up to date')));
  });
});

test('doctorCommand flags an outdated installed skill and stays quiet about ones never installed', () => {
  return withWorkspace(async cwd => {
    await skillsInstallCommand(['claude']);

    const lines = await captureDoctorOutput();
    assert.ok(lines.some(line => line.includes('claude:ctxhub skill up to date')));
    assert.ok(lines.some(line => line.includes('claude:ctxhub-search skill up to date')));
    assert.ok(!lines.some(line => line.includes('cursor:')), 'should not mention an agent that was never installed');

    const skillPath = path.join(cwd, '.claude', 'skills', 'ctxhub', 'SKILL.md');
    await writeText(skillPath, `${await readText(skillPath)}\nstale edit\n`);

    const linesAfterEdit = await captureDoctorOutput();
    assert.ok(
      linesAfterEdit.some(line => line.includes('claude:ctxhub skill is outdated. Run: ctxhub skills install claude'))
    );
    assert.ok(linesAfterEdit.some(line => line.includes('claude:ctxhub-search skill up to date')));
  });
});

test('doctorCommand flags an outdated installed agent MCP config and stays quiet about ones never installed', () => {
  return withWorkspace(async cwd => {
    await agentLaunchCommand('claude', { launch: false });

    const lines = await captureDoctorOutput();
    assert.ok(lines.some(line => line.includes('claude MCP config up to date')));
    assert.ok(!lines.some(line => line.includes('codex MCP config')), 'should not mention an agent that was never configured');

    const mcpConfigPath = path.join(cwd, '.mcp.json');
    const parsed = JSON.parse(await readText(mcpConfigPath));
    parsed.mcpServers.ctxhub.args = ['mcp', '--old-flag'];
    await writeText(mcpConfigPath, JSON.stringify(parsed, null, 2));

    const linesAfterEdit = await captureDoctorOutput();
    assert.ok(
      linesAfterEdit.some(line => line.includes('claude MCP config is outdated. Run: ctxhub agent claude --no-launch'))
    );
  });
});
