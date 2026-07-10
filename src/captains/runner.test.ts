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
import { addCaptainTask } from './tasks.js';
import { eventBus, type CtxhubEventEnvelope } from '../events/eventBus.js';
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

test('runCaptainTask with handoffTo also runs the target task, folding the source answer in as context', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('handoff-ws', async () => {
      const upstream: CaptainTask = { name: 'audit', workspace: 'handoff-ws', query: 'how does authentication work', handoffTo: 'draft-notes' };
      const downstream: CaptainTask = { name: 'draft-notes', workspace: 'handoff-ws', query: 'summarize the above as release notes' };
      await addCaptainTask(downstream);
      await addCaptainTask(upstream);

      const events: CtxhubEventEnvelope[] = [];
      const unsubscribe = eventBus.subscribe(event => events.push(event));
      try {
        const upstreamRecord = await runCaptainTask(upstream);
        assert.equal(upstreamRecord.task, 'audit');
        assert.equal(upstreamRecord.handoffFrom, undefined);

        const downstreamRuns = await listCaptainRuns('draft-notes');
        assert.equal(downstreamRuns.length, 1);
        assert.equal(downstreamRuns[0].handoffFrom, 'audit');
        assert.match(downstreamRuns[0].result.query, /Context handed off from Captain "audit"/);
      } finally {
        unsubscribe();
      }

      assert.ok(events.some(e => e.type === 'captain.handoff' && e.from === 'audit' && e.to === 'draft-notes'));
      assert.ok(events.some(e => e.type === 'captain.run.completed' && e.task === 'draft-notes'));
    });
  });
});

test('runCaptainTask stops a handoff cycle instead of running forever, without losing the original task\'s own recorded run', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('cycle-ws', async () => {
      const a: CaptainTask = { name: 'a', workspace: 'cycle-ws', query: 'a query', handoffTo: 'b' };
      const b: CaptainTask = { name: 'b', workspace: 'cycle-ws', query: 'b query', handoffTo: 'a' };
      await addCaptainTask(b);
      await addCaptainTask(a);

      const events: CtxhubEventEnvelope[] = [];
      const unsubscribe = eventBus.subscribe(event => events.push(event));
      try {
        // The top-level call still resolves (its own run succeeded); the cycle is only detected
        // and stopped once the chain comes back around to "a" a second time.
        const record = await runCaptainTask(a);
        assert.equal(record.task, 'a');
      } finally {
        unsubscribe();
      }

      assert.ok(events.some(e => e.type === 'captain.run.failed' && e.task === 'a' && /cycle/i.test(e.error)));
      assert.equal((await listCaptainRuns('a')).length, 1);
      assert.equal((await listCaptainRuns('b')).length, 1);
    });
  });
});

test('runCaptainTask reports a missing handoff target without failing the task that tried to hand off', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('missing-target-ws', async () => {
      const task: CaptainTask = { name: 'solo', workspace: 'missing-target-ws', query: 'anything', handoffTo: 'does-not-exist' };
      await addCaptainTask(task);

      const events: CtxhubEventEnvelope[] = [];
      const unsubscribe = eventBus.subscribe(event => events.push(event));
      try {
        const record = await runCaptainTask(task);
        assert.equal(record.task, 'solo');
      } finally {
        unsubscribe();
      }

      assert.ok(events.some(e => e.type === 'captain.run.failed' && e.task === 'does-not-exist' && /not a defined captain task/.test(e.error)));
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
