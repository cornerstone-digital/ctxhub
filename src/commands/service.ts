import path from 'node:path';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { openSync } from 'node:fs';
import chalk from 'chalk';
import { getCtxhubHome } from '../workspaces/registry.js';
import { createServiceServer, DEFAULT_SERVICE_PORT } from '../service/server.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';

// docs/control-plane.md Phase 2: reuses `ctxhub watch --detach`'s exact established pattern
// (detached child process, PID + log file, signal-based liveness/stop) at user scope instead of
// per-workspace, rather than registering a real OS-level service (launchd/systemd) -- deferred
// until this simpler mode has proven itself, per the reasoning in docs/control-plane.md.
export function servicePidFile(): string {
  return path.join(getCtxhubHome(), 'service.pid');
}

export function serviceLogFile(): string {
  return path.join(getCtxhubHome(), 'service.log');
}

export type ServiceStartOptions = { foreground?: boolean; port?: string };

export async function serviceStartCommand(opts: ServiceStartOptions = {}): Promise<void> {
  if (opts.foreground) {
    await runForegroundService(Number(opts.port ?? DEFAULT_SERVICE_PORT));
    return;
  }

  await startBackgroundService(opts);
}

async function runForegroundService(port: number): Promise<void> {
  const server = createServiceServer();
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(chalk.green(`ctxhub control-plane service listening on http://127.0.0.1:${port}`));
  console.log(chalk.gray('Press Ctrl+C to stop.'));
}

async function startBackgroundService(opts: ServiceStartOptions): Promise<void> {
  const pidPath = servicePidFile();
  const logPath = serviceLogFile();

  if (await isServiceRunning()) {
    console.log(chalk.yellow(`ctxhub service is already running in the background (pid ${(await readText(pidPath)).trim()}).`));
    console.log(chalk.gray('Stop it first with: ctxhub service stop'));
    return;
  }

  await ensureDir(getCtxhubHome());

  const args = ['service', 'start', '--foreground'];
  if (opts.port) args.push('--port', opts.port);

  // Re-invokes this exact same CLI entry point as a detached child, same as ctxhub watch --detach.
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [process.argv[1], ...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();

  await writeText(pidPath, String(child.pid));
  console.log(chalk.green(`ctxhub control-plane service starting in the background (pid ${child.pid}).`));
  console.log(chalk.gray(`Logs: ${logPath}`));
  console.log(chalk.gray('Stop with: ctxhub service stop'));
}

export async function serviceStopCommand(): Promise<void> {
  const pidPath = servicePidFile();

  if (!(await pathExists(pidPath))) {
    console.log(chalk.yellow('No background ctxhub service is running (no PID file found).'));
    return;
  }

  const pid = Number((await readText(pidPath)).trim());
  try {
    if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
    console.log(chalk.green(`Stopped ctxhub service (pid ${pid}).`));
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

export async function serviceStatusCommand(): Promise<void> {
  const pidPath = servicePidFile();

  if (!(await isServiceRunning())) {
    console.log(chalk.gray('ctxhub service is not running in the background.'));
    return;
  }

  const pid = (await readText(pidPath)).trim();
  console.log(chalk.green(`ctxhub service is running in the background (pid ${pid}).`));
  console.log(chalk.gray(`Logs: ${serviceLogFile()}`));
}

export async function isServiceRunning(): Promise<boolean> {
  const pidPath = servicePidFile();
  if (!(await pathExists(pidPath))) return false;

  const pid = Number((await readText(pidPath)).trim());
  if (!Number.isFinite(pid)) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
