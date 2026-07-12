import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isServiceRunning, runForegroundService, serviceStatusCommand, serviceStopCommand, servicePidFile } from './service.js';
import { pathExists, writeText } from '../utils/fs.js';
import { addCaptainTask } from '../captains/tasks.js';
import { registerWorkspace } from '../workspaces/registry.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-service-home-'));
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

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test('isServiceRunning returns false when no PID file exists', () => {
  return withIsolatedCtxhubHome(async () => {
    assert.equal(await isServiceRunning(), false);
  });
});

test('service stop / status correctly detect and terminate a real running background process', () => {
  return withIsolatedCtxhubHome(async () => {
    // A real, harmless long-lived process standing in for the background service -- avoids
    // depending on process.argv[1] (the test runner itself here, not ctxhub's own CLI entry),
    // same rationale as watch.test.ts's equivalent test.
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      await writeText(servicePidFile(), String(dummy.pid));

      assert.equal(await isServiceRunning(), true);

      const statusLines = await captureLog(() => serviceStatusCommand());
      assert.ok(statusLines.some(line => line.includes('running in the background')));

      const stopLines = await captureLog(() => serviceStopCommand());
      assert.ok(stopLines.some(line => line.includes('Stopped ctxhub service')));

      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && (await isServiceRunning())) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(await isServiceRunning(), false);
      assert.equal(await pathExists(servicePidFile()), false, 'PID file should be removed after stop');
    } finally {
      dummy.kill('SIGKILL');
    }
  });
});

test('service stop reports cleanly and removes a stale PID file referencing a process that is no longer running', () => {
  return withIsolatedCtxhubHome(async () => {
    const dummy = spawn(process.execPath, ['-e', '1'], { stdio: 'ignore' });
    await new Promise<void>(resolve => dummy.on('exit', () => resolve()));

    await writeText(servicePidFile(), String(dummy.pid));

    const lines = await captureLog(() => serviceStopCommand());
    assert.ok(lines.some(line => line.includes('stale PID file')));
    assert.equal(await pathExists(servicePidFile()), false);
  });
});

test('service stop / status report cleanly when nothing is running', () => {
  return withIsolatedCtxhubHome(async () => {
    const stopLines = await captureLog(() => serviceStopCommand());
    assert.ok(stopLines.some(line => line.includes('No background ctxhub service is running')));

    const statusLines = await captureLog(() => serviceStatusCommand());
    assert.ok(statusLines.some(line => line.includes('not running in the background')));
  });
});

// docs/control-plane.md Phase 6 follow-up: the running service is what turns a captain task's
// schedule into a real trigger.
test('runForegroundService polls and runs due captain tasks on its own interval', () => {
  return withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-service-captain-ws-'));
    try {
      await initConfig('service-captain-ws', workspaceDir);
      await mkdir(path.join(workspaceDir, 'app'), { recursive: true });
      await writeFile(path.join(workspaceDir, 'app', 'README.md'), '# App\n\n## Authentication flow\n\nAuth via JWT.\n');

      const config = await loadConfig(workspaceDir);
      config.repositories.push({ name: 'app', path: './app', git: false });
      config.index.provider = 'local-json';
      config.index.path = '.ctxhub/index/local.json';
      await saveConfig(config, workspaceDir);
      await indexWorkspace(workspaceDir);
      await registerWorkspace(workspaceDir, 'service-captain-ws');

      await addCaptainTask({
        name: 'auto-audit',
        workspace: 'service-captain-ws',
        query: 'how does auth work',
        schedule: { everyMinutes: 30 }
      });

      const lines: string[] = [];
      const handle = await runForegroundService(0, { captainPollIntervalMs: 20, log: line => lines.push(line) });

      try {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && !lines.some(line => line.includes('scheduled captain run'))) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(lines.some(line => line.includes('scheduled captain run: auto-audit')));
      } finally {
        await handle.stop();
      }
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

// Regression test: this line was hardcoded to '127.0.0.1' with no override, which meant
// deploying via the Dockerfile/docker-compose.yml/Helm chart into any containerized
// environment (Kubernetes above all) silently produced a service that refused every
// connection except from inside its own container -- readiness/liveness probes and the
// K8s Service both connect via the pod's real IP, not 127.0.0.1. Only caught by actually
// deploying the Helm chart to a real cluster and watching the pod fail its health checks.
test('runForegroundService binds to 127.0.0.1 by default, and to CTXHUB_HOST when set', () => {
  return withIsolatedCtxhubHome(async () => {
    const lines: string[] = [];
    const handle = await runForegroundService(0, { log: line => lines.push(line) });
    try {
      assert.ok(lines.some(line => line.includes('http://127.0.0.1:')));
    } finally {
      await handle.stop();
    }

    const previous = process.env.CTXHUB_HOST;
    process.env.CTXHUB_HOST = '0.0.0.0';
    try {
      const overrideLines: string[] = [];
      const overrideHandle = await runForegroundService(0, { log: line => overrideLines.push(line) });
      try {
        assert.ok(overrideLines.some(line => line.includes('http://0.0.0.0:')));
      } finally {
        await overrideHandle.stop();
      }
    } finally {
      if (previous === undefined) delete process.env.CTXHUB_HOST;
      else process.env.CTXHUB_HOST = previous;
    }
  });
});
