import path from 'node:path';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { openSync } from 'node:fs';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { CACHE_DIR, loadWorkspaceConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { runWatchWithProgress } from '../tui/progress/WatchProgressApp.js';
import { formatFileProgress } from '../tui/progress/applyIndexProgress.js';
import { notify } from '../utils/notify.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

export const WATCH_PID_FILE = path.join(CACHE_DIR, 'watch.pid');
export const WATCH_LOG_FILE = path.join(CACHE_DIR, 'watch.log');

// Directories that are never worth descending into for change detection -- skipping them at the
// chokidar level (rather than filtering events after the fact) avoids watching potentially huge,
// irrelevant trees (a large node_modules) entirely.
const IGNORED_DIR_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.ctxhub', '.next', 'coverage']);

// How long to wait after the last detected filesystem event before actually re-indexing --
// coalesces a burst of events (a git checkout, an editor's multi-file save) into one pass
// instead of one per file.
const DEBOUNCE_MS = 300;

export type WatchOptions = {
  interval?: string;
  detach?: boolean;
  stop?: boolean;
  status?: boolean;
  notify?: boolean;
};

export async function watchCommand(opts: WatchOptions = {}) {
  const cwd = process.cwd();

  if (opts.stop) {
    await stopBackgroundWatch(cwd);
    return;
  }
  if (opts.status) {
    await printBackgroundWatchStatus(cwd);
    return;
  }
  if (opts.detach) {
    await startBackgroundWatch(cwd, opts);
    return;
  }

  const intervalMs = Number(opts.interval ?? 30) * 1000;

  if (process.stdout.isTTY) {
    await runWatchWithProgress(cwd, intervalMs);
    return;
  }

  console.log(chalk.green(`Watching workspace for changes (fallback full pass every ${intervalMs / 1000}s). Press Ctrl+C to stop.`));
  // Not stopped in the real CLI path -- the process just keeps running (kept alive by the live
  // interval/chokidar watcher inside) until Ctrl+C, same as before this was extracted. The
  // returned handle exists so tests can start this and clean it up deterministically.
  await startForegroundWatch(cwd, { intervalMs, notify: opts.notify });
}

export type ForegroundWatchHandle = { stop(): void };

export async function startForegroundWatch(
  cwd: string,
  opts: { intervalMs: number; notify?: boolean; log?: (line: string) => void }
): Promise<ForegroundWatchHandle> {
  const log = opts.log ?? (line => console.log(line));

  async function run(reason: string) {
    const result = await indexWorkspace(cwd, false, event => {
      // Only the (potentially long-running) file-count progress is worth a log line here;
      // repo-start/repo-missing are one-liners and repo-done is covered by the summary below.
      if (event.type === 'repo-progress' && event.total > 0) {
        log(`${new Date().toISOString()} ${event.repo}: ${formatFileProgress(event.scanned, event.total)}`);
      }
    });
    const changed = result.indexed + result.deleted;
    if (changed) {
      const message = `indexed=${result.indexed} deleted=${result.deleted} skipped=${result.skipped}`;
      log(`${new Date().toISOString()} (${reason}) ${message}`);
      if (opts.notify) notify('ctxhub watch', message);
    }
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const watchedPaths = config.repositories.map(repo => path.resolve(workspaceRoot, repo.path));

  let debounceTimer: NodeJS.Timeout | undefined;
  let watcher: ReturnType<typeof chokidar.watch> | undefined;
  if (watchedPaths.length) {
    watcher = chokidar.watch(watchedPaths, {
      ignoreInitial: true,
      ignored: filePath => isIgnoredPath(filePath),
      awaitWriteFinish: { stabilityThreshold: DEBOUNCE_MS, pollInterval: 50 }
    });
    watcher.on('all', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void run('file change').catch(error => console.error(chalk.red((error as Error).message))), DEBOUNCE_MS);
    });
    watcher.on('error', error => console.error(chalk.red(`watch error: ${(error as Error).message}`)));
  }

  await run('initial');
  // A slower fallback pass alongside the event-driven watcher above -- a safety net for
  // whatever chokidar might miss (network filesystems, some symlink edge cases), not the
  // primary way changes are noticed.
  const intervalHandle = setInterval(() => void run('fallback interval').catch(error => console.error(chalk.red((error as Error).message))), opts.intervalMs);

  return {
    stop() {
      clearInterval(intervalHandle);
      clearTimeout(debounceTimer);
      void watcher?.close();
    }
  };
}

function isIgnoredPath(filePath: string): boolean {
  return filePath.split(path.sep).some(segment => IGNORED_DIR_SEGMENTS.has(segment));
}

async function startBackgroundWatch(cwd: string, opts: WatchOptions): Promise<void> {
  const { workspaceRoot } = await loadWorkspaceConfig(cwd);
  const pidPath = path.join(workspaceRoot, WATCH_PID_FILE);
  const logPath = path.join(workspaceRoot, WATCH_LOG_FILE);

  if (await isBackgroundWatchRunning(workspaceRoot)) {
    console.log(chalk.yellow(`ctxhub watch is already running in the background (pid ${(await readText(pidPath)).trim()}).`));
    console.log(chalk.gray('Stop it first with: ctxhub watch --stop'));
    return;
  }

  const args = ['watch'];
  if (opts.interval) args.push('--interval', opts.interval);
  if (opts.notify) args.push('--notify');

  // Re-invokes this exact same CLI entry point (process.argv[1]) as a detached child running
  // the normal foreground watch loop above, minus --detach -- its stdout/stderr just aren't a
  // TTY anymore (redirected to the log file), so it naturally takes the plain polling+chokidar
  // path rather than the Ink UI.
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [process.argv[1], ...args], {
    cwd: workspaceRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();

  await writeText(pidPath, String(child.pid));
  console.log(chalk.green(`Watching in the background (pid ${child.pid}).`));
  console.log(chalk.gray(`Logs: ${path.relative(cwd, logPath)}`));
  console.log(chalk.gray('Stop with: ctxhub watch --stop'));
}

async function stopBackgroundWatch(cwd: string): Promise<void> {
  const { workspaceRoot } = await loadWorkspaceConfig(cwd);
  const pidPath = path.join(workspaceRoot, WATCH_PID_FILE);

  if (!(await pathExists(pidPath))) {
    console.log(chalk.yellow('No background watch process is running (no PID file found).'));
    return;
  }

  const pid = Number((await readText(pidPath)).trim());
  try {
    if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
    console.log(chalk.green(`Stopped background watch (pid ${pid}).`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      console.log(chalk.yellow(`No process with pid ${pid} is running (stale PID file, removing it).`));
    } else {
      throw error;
    }
  } finally {
    await rm(pidPath, { force: true });
  }
}

async function printBackgroundWatchStatus(cwd: string): Promise<void> {
  const { workspaceRoot } = await loadWorkspaceConfig(cwd);
  const pidPath = path.join(workspaceRoot, WATCH_PID_FILE);

  if (!(await isBackgroundWatchRunning(workspaceRoot))) {
    console.log(chalk.gray('ctxhub watch is not running in the background.'));
    return;
  }

  const pid = (await readText(pidPath)).trim();
  console.log(chalk.green(`ctxhub watch is running in the background (pid ${pid}).`));
  console.log(chalk.gray(`Logs: ${path.join(WATCH_LOG_FILE)}`));
}

export async function isBackgroundWatchRunning(workspaceRoot: string): Promise<boolean> {
  const pidPath = path.join(workspaceRoot, WATCH_PID_FILE);
  if (!(await pathExists(pidPath))) return false;

  const pid = Number((await readText(pidPath)).trim());
  if (!Number.isFinite(pid)) return false;

  try {
    // Signal 0 tests whether the process exists/is signalable without actually killing it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
