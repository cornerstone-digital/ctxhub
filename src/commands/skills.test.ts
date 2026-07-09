import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { skillsInstallCommand } from './skills.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function withTempCwd(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-skills-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await run(dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('skillsInstallCommand with no args installs the ambient and search skills for all supported agents', () => {
  return withTempCwd(async dir => {
    await writeText(path.join(dir, '.github', 'prompts', 'ctxhub.prompt.md'), 'legacy copilot prompt');
    await writeText(path.join(dir, '.cursor', 'commands', 'ctxhub.md'), 'legacy cursor command');

    await skillsInstallCommand();

    const claude = await readText(path.join(dir, '.claude', 'skills', 'ctxhub', 'SKILL.md'));
    assert.equal(claude, await readText(path.join(REPO_ROOT, 'skills', 'claude', 'ctxhub', 'SKILL.md')));
    assert.match(claude, /^---\nname: ctxhub\ndescription: /);

    const claudeSearch = await readText(path.join(dir, '.claude', 'skills', 'ctxhub-search', 'SKILL.md'));
    assert.equal(claudeSearch, await readText(path.join(REPO_ROOT, 'skills', 'claude', 'ctxhub-search', 'SKILL.md')));
    assert.match(claudeSearch, /^---\nname: ctxhub-search\ndescription: /);
    assert.match(claudeSearch, /\$ARGUMENTS/);

    const codex = await readText(path.join(dir, '.agents', 'skills', 'ctxhub', 'SKILL.md'));
    assert.equal(codex, await readText(path.join(REPO_ROOT, 'skills', 'codex', 'ctxhub', 'SKILL.md')));
    assert.equal(codex, claude);

    const codexSearch = await readText(path.join(dir, '.agents', 'skills', 'ctxhub-search', 'SKILL.md'));
    assert.equal(codexSearch, claudeSearch);

    const copilotSkill = await readText(path.join(dir, '.github', 'skills', 'ctxhub', 'SKILL.md'));
    assert.equal(copilotSkill, await readText(path.join(REPO_ROOT, 'skills', 'copilot', 'ctxhub', 'SKILL.md')));
    assert.match(copilotSkill, /^---\nname: ctxhub\n/);

    const copilotSearchSkill = await readText(path.join(dir, '.github', 'skills', 'ctxhub-search', 'SKILL.md'));
    assert.equal(copilotSearchSkill, await readText(path.join(REPO_ROOT, 'skills', 'copilot', 'ctxhub-search', 'SKILL.md')));
    assert.match(copilotSearchSkill, /^---\nname: ctxhub-search\n/);
    assert.equal(await pathExists(path.join(dir, '.github', 'prompts', 'ctxhub.prompt.md')), false);

    const cursor = await readText(path.join(dir, '.cursor', 'skills', 'ctxhub', 'SKILL.md'));
    assert.equal(cursor, await readText(path.join(REPO_ROOT, 'skills', 'cursor', 'ctxhub', 'SKILL.md')));
    assert.match(cursor, /^---\nname: ctxhub\n/);

    const cursorSearch = await readText(path.join(dir, '.cursor', 'skills', 'ctxhub-search', 'SKILL.md'));
    assert.equal(cursorSearch, await readText(path.join(REPO_ROOT, 'skills', 'cursor', 'ctxhub-search', 'SKILL.md')));
    assert.match(cursorSearch, /^---\nname: ctxhub-search\n/);
    assert.equal(await pathExists(path.join(dir, '.cursor', 'commands', 'ctxhub.md')), false);
  });
});

test('skillsInstallCommand with specific agents only installs those', () => {
  return withTempCwd(async dir => {
    await skillsInstallCommand(['claude']);

    await assert.doesNotReject(() => readText(path.join(dir, '.claude', 'skills', 'ctxhub', 'SKILL.md')));
    await assert.rejects(() => readText(path.join(dir, '.cursor', 'skills', 'ctxhub', 'SKILL.md')));
  });
});

test('skillsInstallCommand writes to the workspace root and links configured child repos', () => {
  return withTempCwd(async dir => {
    await initConfig('skills-ws', dir);
    const child = path.join(dir, 'app');
    await mkdir(child);
    const config = await loadConfig(dir);
    config.repositories.push({ name: 'app', path: './app', git: false });
    await saveConfig(config, dir);
    process.chdir(child);

    await skillsInstallCommand(['claude']);

    assert.equal(await pathExists(path.join(dir, '.claude', 'skills', 'ctxhub', 'SKILL.md')), true);
    const childSkillPath = path.join(child, '.claude', 'skills', 'ctxhub', 'SKILL.md');
    assert.equal(await pathExists(childSkillPath), true);
    assert.equal((await lstat(childSkillPath)).isSymbolicLink(), true);
    assert.equal(
      await readText(childSkillPath),
      await readText(path.join(dir, '.claude', 'skills', 'ctxhub', 'SKILL.md'))
    );
  });
});

test('skillsInstallCommand rejects unsupported agent names before writing anything', () => {
  return withTempCwd(async dir => {
    await assert.rejects(() => skillsInstallCommand(['claude', 'not-a-real-agent']), /Unsupported agent/);
    await assert.rejects(() => readText(path.join(dir, '.claude', 'skills', 'ctxhub', 'SKILL.md')));
  });
});
