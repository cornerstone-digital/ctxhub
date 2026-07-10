import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { isCaptainTaskDue, runDueCaptainTasks } from './scheduler.js';
import { addCaptainTask } from './tasks.js';
import type { CaptainRunRecord } from './runner.js';
import { registerWorkspace } from '../workspaces/registry.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

function fakeRun(startedAt: string): CaptainRunRecord {
  return {
    runId: startedAt.replace(/[:.]/g, '-'),
    task: 't',
    workspace: 'ws',
    startedAt,
    result: {
      query: 'q',
      workspace: 'ws',
      generatedAt: startedAt,
      answer: [],
      evidence: [],
      citations: [],
      freshness: { staleCount: 0, notes: [] },
      suggestedReadingOrder: []
    }
  };
}

test('isCaptainTaskDue is false for a task with no schedule', () => {
  assert.equal(isCaptainTaskDue({ name: 't', workspace: 'ws', query: 'q' }, []), false);
});

test('isCaptainTaskDue is true for a scheduled task with no prior runs', () => {
  assert.equal(isCaptainTaskDue({ name: 't', workspace: 'ws', query: 'q', schedule: { everyMinutes: 30 } }, []), true);
});

test('isCaptainTaskDue compares against the most recent run, not the oldest', () => {
  const task = { name: 't', workspace: 'ws', query: 'q', schedule: { everyMinutes: 30 } };
  const now = new Date('2026-01-01T01:00:00.000Z');
  const runs = [fakeRun('2025-01-01T00:00:00.000Z'), fakeRun('2026-01-01T00:45:00.000Z')];

  // 15 minutes since the most recent run, schedule is every 30 -- not due yet.
  assert.equal(isCaptainTaskDue(task, runs, now), false);
});

test('isCaptainTaskDue is true once the schedule interval has elapsed since the last run', () => {
  const task = { name: 't', workspace: 'ws', query: 'q', schedule: { everyMinutes: 30 } };
  const now = new Date('2026-01-01T01:00:00.000Z');
  const runs = [fakeRun('2026-01-01T00:29:00.000Z')];

  assert.equal(isCaptainTaskDue(task, runs, now), true);
});

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-scheduler-home-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = ctxhubHome;

  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(ctxhubHome, { recursive: true, force: true });
  }
}

test('runDueCaptainTasks skips unscheduled tasks and runs only tasks that are due', () => {
  return withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-scheduler-ws-'));
    try {
      await initConfig('scheduler-ws', workspaceDir);
      await mkdir(path.join(workspaceDir, 'app'), { recursive: true });
      await writeFile(path.join(workspaceDir, 'app', 'README.md'), '# App\n\n## Authentication flow\n\nAuth via JWT.\n');

      const config = await loadConfig(workspaceDir);
      config.repositories.push({ name: 'app', path: './app', git: false });
      config.index.provider = 'local-json';
      config.index.path = '.ctxhub/index/local.json';
      await saveConfig(config, workspaceDir);
      await indexWorkspace(workspaceDir);
      await registerWorkspace(workspaceDir, 'scheduler-ws');

      await addCaptainTask({ name: 'manual-only', workspace: 'scheduler-ws', query: 'q' });
      await addCaptainTask({ name: 'scheduled', workspace: 'scheduler-ws', query: 'how does auth work', schedule: { everyMinutes: 30 } });

      const ran = await runDueCaptainTasks();
      assert.equal(ran.length, 1);
      assert.equal(ran[0].task, 'scheduled');

      // Immediately due again would double-run -- the second poll shouldn't re-run it yet.
      const secondPoll = await runDueCaptainTasks();
      assert.equal(secondPoll.length, 0);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
