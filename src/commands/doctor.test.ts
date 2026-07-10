import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { doctorCommand, type DoctorFixOptions } from './doctor.js';
import { skillsInstallCommand } from './skills.js';
import { agentLaunchCommand } from './agent.js';
import { loadConfig, saveConfig, initConfig, CACHE_DIR, MEMORY_DIR } from '../config/config.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

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

async function captureDoctorOutput(opts: DoctorFixOptions = {}): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await doctorCommand(opts);
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

test('doctorCommand advertises the LLM-backed features flag as ok when disabled, not as a problem', () => {
  return withWorkspace(async () => {
    const lines = await captureDoctorOutput();
    assert.ok(lines.some(line => line.includes('LLM-backed features disabled (opt-in)')));
  });
});

test('doctorCommand warns when llm.enabled but the explicitly configured agent is not on PATH', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    config.llm.agent = 'definitely-not-a-real-agent-cli-xyz' as never;
    await saveConfig(config, cwd);

    const lines = await captureDoctorOutput();
    assert.ok(
      lines.some(line =>
        line.includes('LLM-backed features enabled, but configured agent "definitely-not-a-real-agent-cli-xyz" was not found on PATH')
      )
    );
  });
});

test('doctorCommand --fix --dry-run reports intended changes without writing anything', () => {
  return withWorkspace(async cwd => {
    await rm(path.join(cwd, CACHE_DIR), { recursive: true, force: true });

    const lines = await captureDoctorOutput({ fix: true, dryRun: true });
    assert.ok(lines.some(line => line.includes(`Create missing directory ${CACHE_DIR}`)));
    assert.ok(lines.some(line => line.includes('Dry run')));
    assert.ok(!(await pathExists(path.join(cwd, CACHE_DIR))), 'dry run must not create the directory');
  });
});

test('doctorCommand --fix creates missing directories and fills in default privacy config', () => {
  return withWorkspace(async cwd => {
    await rm(path.join(cwd, MEMORY_DIR), { recursive: true, force: true });
    const config = await loadConfig(cwd);
    config.privacy.redactPatterns = [];
    await saveConfig(config, cwd);

    const lines = await captureDoctorOutput({ fix: true });
    assert.ok(lines.some(line => line.includes(`Create missing directory ${MEMORY_DIR}`)));
    assert.ok(lines.some(line => line.includes('Add default privacy.redactPatterns to config')));
    assert.ok(await pathExists(path.join(cwd, MEMORY_DIR)));

    const updated = await loadConfig(cwd);
    assert.ok(updated.privacy.redactPatterns.length > 0);
  });
});

test('doctorCommand --fix leaves stale skills alone unless --fix-skills is passed, then reinstalls them', () => {
  return withWorkspace(async cwd => {
    await skillsInstallCommand(['claude']);
    const skillPath = path.join(cwd, '.claude', 'skills', 'ctxhub', 'SKILL.md');
    const original = await readText(skillPath);
    await writeText(skillPath, `${original}\nstale edit\n`);

    const withoutFlag = await captureDoctorOutput({ fix: true });
    assert.ok(withoutFlag.some(line => line.includes('re-run with --fix-skills')));
    assert.equal(await readText(skillPath), `${original}\nstale edit\n`, 'must not touch skills without --fix-skills');

    const withFlag = await captureDoctorOutput({ fix: true, fixSkills: true });
    assert.ok(withFlag.some(line => line.includes('Reinstall stale claude skill file(s)')));
    assert.equal(await readText(skillPath), original);
  });
});

test('doctorCommand --fix --fix-agent refreshes only the named agent config', () => {
  return withWorkspace(async cwd => {
    await agentLaunchCommand('claude', { launch: false });
    const mcpConfigPath = path.join(cwd, '.mcp.json');
    const parsed = JSON.parse(await readText(mcpConfigPath));
    parsed.mcpServers.ctxhub.args = ['mcp', '--old-flag'];
    await writeText(mcpConfigPath, JSON.stringify(parsed, null, 2));

    const lines = await captureDoctorOutput({ fix: true, fixAgent: 'claude' });
    assert.ok(lines.some(line => line.includes('Refresh claude MCP config')));

    const refreshed = JSON.parse(await readText(mcpConfigPath));
    assert.deepEqual(refreshed.mcpServers.ctxhub.args, ['mcp']);
  });
});
