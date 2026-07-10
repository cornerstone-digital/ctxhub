import http from 'node:http';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { buildDoctorChecks, runDoctorChecks, type CheckLine } from '../commands/doctorChecks.js';
import { getPackageVersion } from '../utils/version.js';

// docs/control-plane.md Phase 2: purely "is the registry queryable over a local API" -- no
// orchestration, no task coordination, no persona/policy logic here. A WebSocket/event-stream
// layer is deliberately deferred until a later phase (Captains) actually produces events worth
// pushing; polling this HTTP API is enough for a Fleet-view UI in the meantime, and building an
// event bus with nothing yet to publish would be speculative infrastructure ahead of a real need.
export const DEFAULT_SERVICE_PORT = 7342;

export type WorkspaceStatusResponse = {
  name: string;
  path: string;
  checks: CheckLine[];
};

export function createServiceServer(): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res).catch(error => sendJson(res, 500, { error: (error as Error).message }));
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', version: getPackageVersion() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/workspaces') {
    const workspaces = await listWorkspaces();
    sendJson(res, 200, { workspaces });
    return;
  }

  const statusMatch = /^\/workspaces\/([^/]+)\/status$/.exec(url.pathname);
  if (req.method === 'GET' && statusMatch) {
    await handleWorkspaceStatus(res, decodeURIComponent(statusMatch[1]));
    return;
  }

  sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
}

async function handleWorkspaceStatus(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace) {
    sendJson(res, 404, { error: `No registered workspace named "${name}"` });
    return;
  }
  if (!workspace.exists) {
    sendJson(res, 404, { error: `Workspace "${name}" is registered but its path no longer exists: ${workspace.path}` });
    return;
  }

  // Reuses ctxhub doctor's own check functions rather than inventing separate health logic --
  // the control plane's idea of a workspace's health should never drift from `ctxhub doctor`'s.
  const { config, configPath } = await loadWorkspaceConfig(workspace.path);
  const checks = buildDoctorChecks(config, configPath, workspace.path);
  const lines = await runDoctorChecks(checks);

  const body: WorkspaceStatusResponse = { name: workspace.name, path: workspace.path, checks: lines };
  sendJson(res, 200, body);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}
