import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isServiceRunning, serviceStatusCommand, serviceStopCommand, servicePidFile } from './service.js';
import { pathExists, writeText } from '../utils/fs.js';

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
