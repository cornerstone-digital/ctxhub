import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { buildDoctorChecks, runDoctorChecks, type CheckLine } from '../commands/doctorChecks.js';
import { getPackageVersion } from '../utils/version.js';
import { renderFleetViewHtml } from './fleetView.js';
import { createExplainResult } from '../commands/explain.js';

// docs/control-plane.md Phase 2: purely "is the registry queryable over a local API" -- no
// orchestration, no task coordination, no persona/policy logic here. A WebSocket/event-stream
// layer is deliberately deferred until a later phase (Captains) actually produces events worth
// pushing; polling this HTTP API is enough for a Fleet-view UI in the meantime, and building an
// event bus with nothing yet to publish would be speculative infrastructure ahead of a real need.
export const DEFAULT_SERVICE_PORT = 7342;

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
    req.on('data', chunk => { data += String(chunk); });
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
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, 'utf-8');
      sendHtml(res, 200, html);
    } else {
      sendHtml(res, 200, renderFleetViewHtml());
    }
    return;
  }

  // Serve Vite build assets
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    const filePath = join(UI_DIST, url.pathname);
    if (existsSync(filePath)) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      const content = readFileSync(filePath);
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

  const chatMatch = /^\/workspaces\/([^/]+)\/chat$/.exec(url.pathname);
  if (req.method === 'POST' && chatMatch) {
    await handleWorkspaceChat(req, res, decodeURIComponent(chatMatch[1]));
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
