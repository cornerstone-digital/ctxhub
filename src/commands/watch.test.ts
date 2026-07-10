import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isBackgroundWatchRunning, startForegroundWatch, watchCommand, WATCH_PID_FILE } from './watch.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { pathExists, writeText } from '../utils/fs.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-watch-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n');

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test('startForegroundWatch runs an initial index pass, then reacts to a real filesystem change via chokidar (not just the interval fallback)', () => {
  return withWorkspace(async cwd => {
    const logLines: string[] = [];
    const handle = await startForegroundWatch(cwd, { intervalMs: 60_000, log: line => logLines.push(line) });
    try {
      // The initial pass indexes app/README.md.
      assert.ok(logLines.some(line => line.includes('(initial)') && line.includes('indexed=1')));

      await writeFile(path.join(cwd, 'app', 'new-file.md'), '# New file\n');

      // Debounce is 300ms; poll well past that without relying on the 60s interval fallback,
      // proving the chokidar-driven path (not the interval) is what triggered this.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !logLines.some(line => line.includes('(file change)'))) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      assert.ok(logLines.some(line => line.includes('(file change)') && line.includes('indexed=1')), `expected a (file change) log line, got: ${JSON.stringify(logLines)}`);
    } finally {
      handle.stop();
    }
  });
});

test('startForegroundWatch works (skipping the chokidar setup) when the workspace has no configured repositories', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.repositories = [];
    await saveConfig(config, cwd);

    const logLines: string[] = [];
    const handle = await startForegroundWatch(cwd, { intervalMs: 60_000, log: line => logLines.push(line) });
    handle.stop();
    // No crash, no repos to report a change for.
    assert.ok(!logLines.some(line => line.includes('indexed=')));
  });
});

test('isBackgroundWatchRunning returns false when no PID file exists', () => {
  return withWorkspace(async cwd => {
    assert.equal(await isBackgroundWatchRunning(cwd), false);
  });
});

test('watch --status / --stop correctly detect and terminate a real running background process', () => {
  return withWorkspace(async cwd => {
    // Spawn a real, harmless long-lived process to stand in for the background watcher --
    // avoids depending on process.argv[1] (which, in this test process, is the test runner
    // itself, not ctxhub's own CLI entry) to prove the PID-file lifecycle logic in isolation.
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const pidPath = path.join(cwd, WATCH_PID_FILE);
      await writeText(pidPath, String(dummy.pid));

      assert.equal(await isBackgroundWatchRunning(cwd), true);

      const statusLines = await captureLog(() => watchCommand({ status: true }));
      assert.ok(statusLines.some(line => line.includes('running in the background')));

      const stopLines = await captureLog(() => watchCommand({ stop: true }));
      assert.ok(stopLines.some(line => line.includes('Stopped background watch')));

      // Give the OS a moment to actually reap the signaled process.
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && (await isBackgroundWatchRunning(cwd))) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(await isBackgroundWatchRunning(cwd), false);
      assert.equal(await pathExists(pidPath), false, 'PID file should be removed after --stop');
    } finally {
      dummy.kill('SIGKILL');
    }
  });
});

test('watch --stop reports cleanly and removes a stale PID file referencing a process that is no longer running', () => {
  return withWorkspace(async cwd => {
    const dummy = spawn(process.execPath, ['-e', '1'], { stdio: 'ignore' });
    await new Promise<void>(resolve => dummy.on('exit', () => resolve()));

    const pidPath = path.join(cwd, WATCH_PID_FILE);
    await writeText(pidPath, String(dummy.pid));

    const lines = await captureLog(() => watchCommand({ stop: true }));
    assert.ok(lines.some(line => line.includes('stale PID file')));
    assert.equal(await pathExists(pidPath), false);
  });
});

test('watch --stop / --status report cleanly when nothing is running', () => {
  return withWorkspace(async () => {
    const stopLines = await captureLog(() => watchCommand({ stop: true }));
    assert.ok(stopLines.some(line => line.includes('No background watch process is running')));

    const statusLines = await captureLog(() => watchCommand({ status: true }));
    assert.ok(statusLines.some(line => line.includes('not running in the background')));
  });
});
