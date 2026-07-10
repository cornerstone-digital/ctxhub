import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import {
  captainAddCommand,
  captainApprovalsCommand,
  captainListCommand,
  captainPromoteCommand,
  captainRemoveCommand,
  captainRunCommand
} from './captain.js';
import { registerWorkspace } from '../workspaces/registry.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-captain-cmd-home-'));
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

async function withRegisteredWorkspace(name: string, run: () => Promise<void>) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `ctxhub-captain-cmd-ws-${name}-`));
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

    await run();
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  return { lines, restore: () => { console.log = original; } };
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const capture = captureConsole();
  try {
    await run();
  } finally {
    capture.restore();
  }
  return capture.lines;
}

test('captainAddCommand requires --workspace and --query, then lists and removes the task', () => {
  return withIsolatedCtxhubHome(async () => {
    await assert.rejects(() => captainAddCommand('t', {}), /--workspace is required/);
    await assert.rejects(() => captainAddCommand('t', { workspace: 'ws1' }), /--query is required/);

    const addLines = await captureLog(() => captainAddCommand('nightly-audit', { workspace: 'ws1', query: 'any risks?' }));
    assert.ok(addLines.some(line => line.includes('Added captain task "nightly-audit"')));

    const listLines = await captureLog(() => captainListCommand());
    assert.ok(listLines.some(line => line.includes('nightly-audit') && line.includes('ws1')));

    const removeLines = await captureLog(() => captainRemoveCommand('nightly-audit'));
    assert.ok(removeLines.some(line => line.includes('Removed captain task "nightly-audit"')));

    const afterRemoveLines = await captureLog(() => captainListCommand());
    assert.ok(afterRemoveLines.some(line => line.includes('No captain tasks configured')));
  });
});

test('captainAddCommand --schedule-every-minutes validates and records the schedule', () => {
  return withIsolatedCtxhubHome(async () => {
    await assert.rejects(
      () => captainAddCommand('t', { workspace: 'ws1', query: 'q', scheduleEveryMinutes: '0' }),
      /--schedule-every-minutes must be a positive number/
    );
    await assert.rejects(
      () => captainAddCommand('t', { workspace: 'ws1', query: 'q', scheduleEveryMinutes: 'nope' }),
      /--schedule-every-minutes must be a positive number/
    );

    const lines = await captureLog(() =>
      captainAddCommand('nightly-audit', { workspace: 'ws1', query: 'any risks?', scheduleEveryMinutes: '30' })
    );
    assert.ok(lines.some(line => line.includes('Scheduled: runs every 30 minute(s)')));

    const listLines = await captureLog(() => captainListCommand());
    assert.ok(listLines.some(line => line.includes('every=30m')));
  });
});

test('captainRemoveCommand reports cleanly when the task does not exist', () => {
  return withIsolatedCtxhubHome(async () => {
    const lines = await captureLog(() => captainRemoveCommand('not-real'));
    assert.ok(lines.some(line => line.includes('No captain task named "not-real"')));
  });
});

test('captainRunCommand runs a defined task, then captainApprovals lists it, then captainPromote writes a note', () => {
  return withIsolatedCtxhubHome(async () => {
    await withRegisteredWorkspace('captain-cmd-ws', async () => {
      await captainAddCommand('auth-check', { workspace: 'captain-cmd-ws', query: 'how does authentication work' });

      await assert.rejects(() => captainRunCommand('not-real'), /No captain task named "not-real"/);

      const runLines = await captureLog(() => captainRunCommand('auth-check'));
      assert.ok(runLines.some(line => line.includes('Ran captain task "auth-check"')));
      const runIdLine = runLines.find(line => line.includes('Pending review. Promote with:'));
      assert.ok(runIdLine);
      const runId = runIdLine!.split('auth-check ')[1]?.split(' ')[0];
      assert.ok(runId);

      const approvalsLines = await captureLog(() => captainApprovalsCommand('auth-check'));
      assert.ok(approvalsLines.some(line => line.includes(runId!)));

      const promoteLines = await captureLog(() => captainPromoteCommand('auth-check', runId!, 'app', {}));
      assert.ok(promoteLines.some(line => line.includes(`Promoted run ${runId} of "auth-check"`)));
    });
  });
});

test('captainApprovalsCommand reports cleanly when there are no pending runs', () => {
  return withIsolatedCtxhubHome(async () => {
    const lines = await captureLog(() => captainApprovalsCommand('never-run'));
    assert.ok(lines.some(line => line.includes('No pending runs for captain task "never-run"')));
  });
});
