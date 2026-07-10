import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { getCaptainRun, listCaptainRuns, promoteCaptainRun, runCaptainTask } from './runner.js';
import { registerWorkspace } from '../workspaces/registry.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { pathExists, readText } from '../utils/fs.js';
import type { CaptainTask } from './tasks.js';

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-captain-home-'));
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

async function withRegisteredWorkspace(name: string, run: (workspaceDir: string) => Promise<void>) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `ctxhub-captain-ws-${name}-`));
  try {
    await initConfig(name, workspaceDir);
    await mkdir(path.join(workspaceDir, 'app'), { recursive: true });
    await writeFile(
      path.join(workspaceDir, 'app', 'README.md'),
      '# App\n\n## Authentication flow\n\nAuth is handled via JWT tokens.\n'
    );

    const config = await loadConfig(workspaceDir);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, workspaceDir);
    await indexWorkspace(workspaceDir);
    await registerWorkspace(workspaceDir, name);

    await run(workspaceDir);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

test('runCaptainTask rejects a task targeting an unregistered workspace', () => {
  return withIsolatedCtxhubHome(async () => {
    const task: CaptainTask = { name: 't', workspace: 'not-registered', query: 'anything' };
    await assert.rejects(() => runCaptainTask(task), /unregistered workspace "not-registered"/);
  });
});

test('runCaptainTask runs the evidence-grounded query against the registered workspace and writes a pending run record', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('audit-ws', async () => {
      const task: CaptainTask = { name: 'nightly-audit', workspace: 'audit-ws', query: 'how does authentication work' };
      const record = await runCaptainTask(task);

      assert.equal(record.task, 'nightly-audit');
      assert.equal(record.workspace, 'audit-ws');
      assert.ok(record.runId);
      assert.equal(record.result.query, 'how does authentication work');
      assert.ok(record.result.evidence.length > 0);

      const stored = await getCaptainRun('nightly-audit', record.runId);
      assert.deepEqual(stored, record);
    });
  });
});

test('listCaptainRuns is empty before any run and lists runs afterward', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('list-ws', async () => {
      assert.deepEqual(await listCaptainRuns('list-task'), []);

      const task: CaptainTask = { name: 'list-task', workspace: 'list-ws', query: 'authentication flow' };
      const record = await runCaptainTask(task);

      const runs = await listCaptainRuns('list-task');
      assert.equal(runs.length, 1);
      assert.equal(runs[0].runId, record.runId);
    });
  });
});

test('promoteCaptainRun writes an AI-draft note into the target workspace\'s repo and rejects an unknown run', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('promote-ws', async workspaceDir => {
      const task: CaptainTask = { name: 'promote-task', workspace: 'promote-ws', query: 'how does authentication work' };
      const record = await runCaptainTask(task);

      await assert.rejects(() => promoteCaptainRun('promote-task', 'not-a-real-run', 'app'), /No run "not-a-real-run"/);
      await assert.rejects(() => promoteCaptainRun('promote-task', record.runId, 'not-a-real-repo'), /Repository not found/);

      const notePath = await promoteCaptainRun('promote-task', record.runId, 'app', { agent: 'test-captain' });
      assert.ok(await pathExists(notePath));
      assert.ok(notePath.startsWith(path.join(workspaceDir, 'app', 'agent-notes')));

      const content = await readText(notePath);
      assert.match(content, /agent: test-captain/);
      assert.match(content, /draft: ai-pending-review/);
      assert.match(content, /## Answer/);
    });
  });
});
