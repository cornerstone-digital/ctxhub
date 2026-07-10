import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { addCaptainTask, getCaptainTask, loadCaptainTasks, removeCaptainTask } from './tasks.js';

async function withTempTasksPath(run: (tasksPath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-captain-tasks-'));
  try {
    await run(path.join(dir, 'captains.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadCaptainTasks returns an empty file when none exists yet', () => {
  return withTempTasksPath(async tasksPath => {
    assert.deepEqual(await loadCaptainTasks(tasksPath), { version: 1, tasks: [] });
  });
});

test('addCaptainTask adds a task and rejects a duplicate name', () => {
  return withTempTasksPath(async tasksPath => {
    await addCaptainTask({ name: 'nightly-audit', workspace: 'ws1', query: 'any new security risks?' }, tasksPath);

    const file = await loadCaptainTasks(tasksPath);
    assert.equal(file.tasks.length, 1);
    assert.equal(file.tasks[0].name, 'nightly-audit');

    await assert.rejects(
      () => addCaptainTask({ name: 'nightly-audit', workspace: 'ws2', query: 'other' }, tasksPath),
      /already exists/
    );
  });
});

test('getCaptainTask finds a task by name and returns undefined otherwise', () => {
  return withTempTasksPath(async tasksPath => {
    await addCaptainTask({ name: 'nightly-audit', workspace: 'ws1', query: 'q', persona: 'architect', profile: 'fast' }, tasksPath);

    const found = await getCaptainTask('nightly-audit', tasksPath);
    assert.deepEqual(found, { name: 'nightly-audit', workspace: 'ws1', query: 'q', persona: 'architect', profile: 'fast' });
    assert.equal(await getCaptainTask('not-real', tasksPath), undefined);
  });
});

test('removeCaptainTask removes a task and reports false when not found', () => {
  return withTempTasksPath(async tasksPath => {
    await addCaptainTask({ name: 'nightly-audit', workspace: 'ws1', query: 'q' }, tasksPath);

    assert.equal(await removeCaptainTask('not-real', tasksPath), false);
    assert.equal(await removeCaptainTask('nightly-audit', tasksPath), true);

    const file = await loadCaptainTasks(tasksPath);
    assert.equal(file.tasks.length, 0);
  });
});
