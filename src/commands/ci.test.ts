import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { ciInitCommand, createGithubActionsWorkflow } from './ci.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-ci-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await run(dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('createGithubActionsWorkflow includes docs validation and optional evals', () => {
  const workflow = createGithubActionsWorkflow({ packageManager: 'npm', withEval: true });

  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build --if-present/);
  assert.match(workflow, /npx ctxhub validate docs/);
  assert.match(workflow, /npx ctxhub eval/);
});

test('createGithubActionsWorkflow supports pnpm', () => {
  const workflow = createGithubActionsWorkflow({ packageManager: 'pnpm', withEval: false });

  assert.match(workflow, /cache: pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run build --if-present/);
  assert.doesNotMatch(workflow, /ctxhub eval/);
});

test('ciInitCommand creates the ctxhub workflow and refuses overwrite without force', () => {
  return withTempDir(async dir => {
    const workflowPath = path.join(dir, '.github', 'workflows', 'ctxhub.yml');

    await ciInitCommand({ withEval: true });

    assert.equal(await pathExists(workflowPath), true);
    assert.match(await readText(workflowPath), /npx ctxhub eval/);

    await assert.rejects(() => ciInitCommand(), /already exists/);
  });
});

test('ciInitCommand overwrites when force is set', () => {
  return withTempDir(async dir => {
    const workflowPath = path.join(dir, '.github', 'workflows', 'ctxhub.yml');
    await writeText(workflowPath, 'old');

    await ciInitCommand({ force: true, packageManager: 'yarn' });

    const workflow = await readText(workflowPath);
    assert.match(workflow, /cache: yarn/);
    assert.match(workflow, /yarn install --frozen-lockfile/);
  });
});
