import path from 'node:path';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { openSync } from 'node:fs';
import chalk from 'chalk';
import { getCtxhubHome } from '../workspaces/registry.js';
import { createServiceServer, DEFAULT_SERVICE_PORT } from '../service/server.js';
import { runDueCaptainTasks } from '../captains/scheduler.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
import { openReport } from './report.js';

// docs/control-plane.md Phase 6 follow-up: how often the running service checks captain task
// schedules. Schedules are expressed in whole minutes, so a 60s poll gives at most ~1 minute of
// latency on a due task -- the same "periodic fallback pass" granularity ctxhub watch already uses.
const CAPTAIN_POLL_INTERVAL_MS = 60_000;

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

export type ForegroundServiceHandle = { stop(): Promise<void> };

// Exported (mirrors watch.ts's startForegroundWatch/ForegroundWatchHandle pattern exactly) so
// tests can start this, control time, and clean it up deterministically instead of waiting on a
// real 60s interval.
export async function runForegroundService(
  port: number,
  opts: { captainPollIntervalMs?: number; log?: (line: string) => void } = {}
): Promise<ForegroundServiceHandle> {
  const log = opts.log ?? (line => console.log(line));

  // Loopback-only by default -- this is what a developer running `ctxhub service start` on
  // their own machine wants, not a service exposed on every interface. Containerized
  // deployments (Dockerfile's runtime stage, docker-compose.yml, the Helm chart) set
  // CTXHUB_HOST=0.0.0.0, since inside a container/pod, 127.0.0.1 only accepts connections
  // from within that same network namespace -- Kubernetes liveness/readiness probes and any
  // Service routing hit the pod's real IP and get connection-refused otherwise. Found by
  // actually deploying the Helm chart to a real cluster and watching probes fail, not by
  // reading the code.
  const host = process.env.CTXHUB_HOST ?? '127.0.0.1';
  const server = createServiceServer();
  await new Promise<void>(resolve => server.listen(port, host, resolve));
  log(chalk.green(`ctxhub control-plane service listening on http://${host}:${port}`));
  log(chalk.gray('Press Ctrl+C to stop.'));

  // docs/control-plane.md Phase 6 follow-up: the running service is what turns a captain task's
  // `schedule` into an actual trigger -- ctxhub captain run remains the manual path regardless.
  const pollIntervalMs = opts.captainPollIntervalMs ?? CAPTAIN_POLL_INTERVAL_MS;
  // A tick is skipped entirely while the previous poll is still running, rather than letting
  // polls overlap -- a slow task (or a poll interval faster than one full run) must never trigger
  // the same task twice concurrently. This also means at most one poll is ever in flight, so
  // `stop()` can reliably wait for it to finish before tearing anything down.
  let pendingPoll: Promise<unknown> = Promise.resolve();
  let pollInFlight = false;
  const intervalHandle = setInterval(() => {
    if (pollInFlight) return;
    pollInFlight = true;

    pendingPoll = runDueCaptainTasks()
      .then(
        ran => {
          for (const record of ran) log(chalk.gray(`[ctxhub] scheduled captain run: ${record.task} (${record.runId})`));
        },
        error => log(chalk.red(`[ctxhub] captain scheduler error: ${(error as Error).message}`))
      )
      .finally(() => {
        pollInFlight = false;
      });
  }, pollIntervalMs);

  // Auto-heartbeat: if peerUrl is configured, send heartbeats every 60s
  const serviceConfig = await loadServiceConfig();
  let heartbeatHandle: ReturnType<typeof setInterval> | undefined;
  if (serviceConfig.peerUrl) {
    const orgId = process.env['CTXHUB_ORG_ID'];
    const groupId = process.env['CTXHUB_GROUP_ID'];
    if (orgId && groupId) {
      const sendHeartbeat = async () => {
        try {
          await fetch(`http://127.0.0.1:${port}/peers/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId, peerUrl: serviceConfig.peerUrl, groupId }),
          });
        } catch {
          // Heartbeat is best-effort; failures don't stop the service
        }
      };
      void sendHeartbeat();
      heartbeatHandle = setInterval(() => { void sendHeartbeat(); }, 60_000);
    }
  }

  return {
    async stop() {
      if (heartbeatHandle !== undefined) clearInterval(heartbeatHandle);
      clearInterval(intervalHandle);
      await pendingPoll;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
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

// Polls GET /health instead of a fixed sleep before opening the browser -- startBackgroundService
// returns as soon as the detached child is spawned, not once its HTTP server is actually
// listening, and a browser tab opened a beat too early just shows a connection-refused with
// nothing to retry. Gives up and opens anyway after ~3s so a slow-but-working start still ends
// with a browser tab pointed at the right place instead of silently doing nothing.
async function waitForServiceReady(port: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) });
      if (res.ok) return true;
    } catch {
      // Not up yet -- keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

export type DashboardOptions = { port?: string };

export async function dashboardCommand(opts: DashboardOptions = {}): Promise<void> {
  const port = Number(opts.port ?? DEFAULT_SERVICE_PORT);

  if (await isServiceRunning()) {
    console.log(chalk.gray('ctxhub service is already running.'));
  } else {
    await startBackgroundService(opts);
    const ready = await waitForServiceReady(port);
    if (!ready) {
      console.log(chalk.yellow(`Service hasn't confirmed it's ready yet -- opening anyway; refresh the page if it doesn't load immediately.`));
    }
  }

  const url = `http://127.0.0.1:${port}`;
  console.log(chalk.green(`Opening ${url}`));
  // openReport just shells out to the OS's "open this" command (open/xdg-open/start) -- works
  // identically for a URL as it does for the file paths it's named after.
  openReport(url);
}

// ── servicePeerUrlCommand ─────────────────────────────────────────────────────

/**
 * Saves the public peer URL for this ctxhub instance to ~/.ctxhub/service-config.json.
 * This URL is sent in heartbeats so other instances can discover this one.
 */
export function getServiceConfigPath(): string {
  return path.join(getCtxhubHome(), 'service-config.json');
}

export async function loadServiceConfig(): Promise<{ peerUrl?: string }> {
  const configPath = getServiceConfigPath();
  if (!(await pathExists(configPath))) return {};
  try {
    const raw = await readText(configPath);
    return JSON.parse(raw) as { peerUrl?: string };
  } catch {
    return {};
  }
}

export async function serviceSetPeerUrlCommand(peerUrl: string): Promise<void> {
  if (!peerUrl?.trim()) {
    console.error('Error: <url> argument is required');
    process.exit(1);
  }

  const config = await loadServiceConfig();
  config.peerUrl = peerUrl.trim();
  await writeText(getServiceConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
  console.log(chalk.green(`Peer URL set: ${peerUrl.trim()}`));
  console.log(chalk.gray('This URL will be announced via heartbeat when the service runs.'));
}
