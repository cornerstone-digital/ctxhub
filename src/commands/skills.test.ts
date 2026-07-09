import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { skillsInstallCommand } from './skills.js';
import { readText } from '../utils/fs.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function withTempCwd(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ssd-skills-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await run(dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('skillsInstallCommand with no args installs for all supported agents by copying the repo templates verbatim', () => {
  return withTempCwd(async dir => {
    await skillsInstallCommand();

    const claude = await readText(path.join(dir, '.claude', 'skills', 'ssd', 'SKILL.md'));
    assert.equal(claude, await readText(path.join(REPO_ROOT, 'skills', 'claude', 'SKILL.md')));
    assert.match(claude, /^---\nname: ssd\ndescription: /);

    const codex = await readText(path.join(dir, '.agents', 'skills', 'ssd', 'SKILL.md'));
    assert.equal(codex, await readText(path.join(REPO_ROOT, 'skills', 'codex', 'SKILL.md')));
    assert.equal(codex, claude);

    const copilot = await readText(path.join(dir, '.github', 'prompts', 'ssd.prompt.md'));
    assert.equal(copilot, await readText(path.join(REPO_ROOT, 'skills', 'copilot', 'ssd.prompt.md')));
    assert.match(copilot, /^---\ndescription: /);
    assert.doesNotMatch(copilot, /^---\nname:/);

    const cursor = await readText(path.join(dir, '.cursor', 'commands', 'ssd.md'));
    assert.equal(cursor, await readText(path.join(REPO_ROOT, 'skills', 'cursor', 'ssd.md')));
    assert.match(cursor, /^# Using ssd/);
    assert.doesNotMatch(cursor, /^---/);
  });
});

test('skillsInstallCommand with specific agents only installs those', () => {
  return withTempCwd(async dir => {
    await skillsInstallCommand(['claude']);

    await assert.doesNotReject(() => readText(path.join(dir, '.claude', 'skills', 'ssd', 'SKILL.md')));
    await assert.rejects(() => readText(path.join(dir, '.cursor', 'commands', 'ssd.md')));
  });
});

test('skillsInstallCommand rejects unsupported agent names before writing anything', () => {
  return withTempCwd(async dir => {
    await assert.rejects(() => skillsInstallCommand(['claude', 'not-a-real-agent']), /Unsupported agent/);
    await assert.rejects(() => readText(path.join(dir, '.claude', 'skills', 'ssd', 'SKILL.md')));
  });
});
