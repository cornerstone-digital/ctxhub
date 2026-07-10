import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { buildDoctorChecks, runDoctorChecks, type CheckLine } from '../commands/doctorChecks.js';
import { getPackageVersion } from '../utils/version.js';
import { renderFleetViewHtml } from './fleetView.js';
import { createExplainResult } from '../commands/explain.js';
import { indexWorkspace, type IndexProgressEvent, type IndexResult } from '../indexing/indexer.js';
import { notify } from '../utils/notify.js';
import { eventBus, type CtxhubEventEnvelope } from '../events/eventBus.js';

// docs/control-plane.md Phase 2, extended: the registry-over-HTTP API plus an in-process event
// bus (src/events/eventBus.ts) fed by real producers -- index jobs and Captain runs -- and
// exposed to subscribers over SSE (GET /events) below. Desktop notifications are just one more
// subscriber (see the eventBus.subscribe call below), not something index jobs call directly.
export const DEFAULT_SERVICE_PORT = 7342;

// Desktop notifications are a bus subscriber like any other -- the indexer/captains publish
// facts, they don't know or care that this listener happens to shell out to osascript/notify-send.
eventBus.subscribe(event => {
  if (event.type === 'index.completed') {
    notify('ctxhub', `Finished indexing "${event.workspace}" — ${event.result.indexed} indexed, ${event.result.deleted} deleted`);
  } else if (event.type === 'index.failed') {
    notify('ctxhub', `Indexing "${event.workspace}" failed: ${event.error}`);
  } else if (event.type === 'captain.run.completed') {
    notify('ctxhub', `Captain "${event.task}" finished on "${event.workspace}"`);
  } else if (event.type === 'captain.run.failed') {
    notify('ctxhub', `Captain "${event.task}" failed on "${event.workspace}": ${event.error}`);
  }
});

export type IndexJobStatus = 'idle' | 'running' | 'done' | 'error';

export type IndexJobState = {
  status: IndexJobStatus;
  repo?: string;
  scanned: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  result?: IndexResult;
  error?: string;
};

// In-memory only -- one process per `ctxhub service`, and job state resets on restart same as
// nothing having run yet. Keyed by registry workspace name (not path) so it lines up with the
// same name the UI already polls /workspaces/:name/status under.
const indexJobs = new Map<string, IndexJobState>();

function getIndexJobState(name: string): IndexJobState {
  return indexJobs.get(name) ?? { status: 'idle', scanned: 0, total: 0 };
}

// Fires the index run and returns immediately -- callers get the just-started state back and
// poll GET .../index-status for progress, same polling model as the rest of this API.
function startIndexJob(name: string, workspacePath: string): IndexJobState {
  const existing = indexJobs.get(name);
  if (existing?.status === 'running') return existing;

  const state: IndexJobState = { status: 'running', scanned: 0, total: 0, startedAt: new Date().toISOString() };
  indexJobs.set(name, state);
  eventBus.publish({ type: 'index.started', workspace: name });

  void indexWorkspace(workspacePath, false, (event: IndexProgressEvent) => {
    if (event.type === 'repo-progress') {
      state.repo = event.repo;
      state.scanned = event.scanned;
      state.total = event.total;
      eventBus.publish({ type: 'index.progress', workspace: name, repo: event.repo, scanned: event.scanned, total: event.total });
    }
  })
    .then(result => {
      state.status = 'done';
      state.result = result;
      state.finishedAt = new Date().toISOString();
      eventBus.publish({ type: 'index.completed', workspace: name, result });
    })
    .catch((error: unknown) => {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      state.finishedAt = new Date().toISOString();
      eventBus.publish({ type: 'index.failed', workspace: name, error: state.error });
    });

  return state;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIST = join(__dirname, '..', '..', 'ui', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

export type WorkspaceStatusResponse = {
  name: string;
  path: string;
  checks: CheckLine[];
};

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += String(chunk);
      if (data.length > 1_048_576) { // 1 MB
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

export function createServiceServer(): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res).catch(error => sendJson(res, 500, { error: (error as Error).message }));
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // CORS headers for dev (Vite dev server proxies in prod)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve React UI from ui/dist if built, else fallback to fleet HTML
  if (req.method === 'GET' && url.pathname === '/') {
    const indexPath = join(UI_DIST, 'index.html');
    const indexExists = await fsPromises.access(indexPath).then(() => true).catch(() => false);
    if (indexExists) {
      const html = await fsPromises.readFile(indexPath, 'utf-8');
      sendHtml(res, 200, html);
    } else {
      sendHtml(res, 200, renderFleetViewHtml());
    }
    return;
  }

  // Serve Vite build assets
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    const filePath = join(UI_DIST, url.pathname);
    const fileExists = await fsPromises.access(filePath).then(() => true).catch(() => false);
    if (fileExists) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      const content = await fsPromises.readFile(filePath);
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
      res.end(content);
    } else {
      sendJson(res, 404, { error: 'Asset not found' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', version: getPackageVersion() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    handleEventStream(req, res);
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

  const indexMatch = /^\/workspaces\/([^/]+)\/index$/.exec(url.pathname);
  if (req.method === 'POST' && indexMatch) {
    await handleWorkspaceIndexStart(res, decodeURIComponent(indexMatch[1]));
    return;
  }

  const indexStatusMatch = /^\/workspaces\/([^/]+)\/index-status$/.exec(url.pathname);
  if (req.method === 'GET' && indexStatusMatch) {
    sendJson(res, 200, getIndexJobState(decodeURIComponent(indexStatusMatch[1])));
    return;
  }

  const chatMatch = /^\/workspaces\/([^/]+)\/chat$/.exec(url.pathname);
  if (req.method === 'POST' && chatMatch) {
    await handleWorkspaceChat(req, res, decodeURIComponent(chatMatch[1]));
    return;
  }

  sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
}

// Server-Sent Events, not WebSocket: this stream is one-way (server -> client), which is all the
// dashboard and a future MCP-side "watch this workspace" consumer need, and SSE needs nothing
// beyond plain HTTP -- no upgrade handshake, reconnects automatically via EventSource on the
// client. Every connected client gets every event; per-workspace filtering happens client-side.
function handleEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':ok\n\n');

  const unsubscribe = eventBus.subscribe((event: CtxhubEventEnvelope) => {
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', unsubscribe);
}

async function handleWorkspaceIndexStart(res: http.ServerResponse, name: string): Promise<void> {
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

  const state = startIndexJob(name, workspace.path);
  sendJson(res, 202, state);
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

async function handleWorkspaceChat(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace) {
    sendJson(res, 404, { error: `No registered workspace named "${name}"` });
    return;
  }
  if (!workspace.exists) {
    sendJson(res, 404, { error: `Workspace "${name}" path no longer exists: ${workspace.path}` });
    return;
  }

  const body = await readJsonBody(req);
  const query = (body as { query?: unknown }).query;
  if (typeof query !== 'string' || !query.trim()) {
    sendJson(res, 400, { error: 'Missing or empty "query" field in request body' });
    return;
  }

  const result = await createExplainResult(query.trim(), 8, workspace.path);
  sendJson(res, 200, result);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}
