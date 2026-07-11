/**
 * ctxhub Cloud Service — standalone HTTP backend stub.
 *
 * This is the architecturally-correct service stub for the ctxhub Cloud backend.
 * It uses an in-memory store so it can be built and tested without a Postgres
 * connection. In production, the in-memory maps would be replaced with a Postgres
 * + pgvector database.
 *
 * Routes:
 *   POST   /sync                  — receive promoted chunks from a self-hosted instance
 *   GET    /search?q=&orgId=      — search across chunks for an org
 *   GET    /health                — liveness probe
 *   POST   /orgs                  — register an org (admin only)
 *   GET    /orgs/:id/workspaces   — list workspaces for an org
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { getPackageVersion } from '../utils/version.js';
import type {
  CloudChunk,
  CloudOrg,
  CloudWorkspace,
  CloudSyncRequest,
  CloudSyncResponse,
  CloudSearchResult,
} from './types.js';

// ── In-memory store ───────────────────────────────────────────────────────────

export interface CloudStore {
  chunks: Map<string, CloudChunk>;     // key: `${orgId}:${contentHash}`
  orgs: Map<string, CloudOrg>;         // key: org.id
  workspaces: Map<string, CloudWorkspace>; // key: workspace.id
  apiKeys: Map<string, string>;        // key: apiKey → orgId
  adminKeys: Set<string>;              // admin API keys
}

export function createInMemoryStore(): CloudStore {
  return {
    chunks: new Map(),
    orgs: new Map(),
    workspaces: new Map(),
    apiKeys: new Map(),
    adminKeys: new Set(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: unknown) => { data += String(chunk); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function extractBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

const CLOUD_SYNC_TIERS = new Set(['institutional', 'canonical']);

// ── Request handler ───────────────────────────────────────────────────────────

function createHandler(store: CloudStore) {
  return async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    // ── GET /health ───────────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, version: getPackageVersion() });
      return;
    }

    // ── POST /sync ────────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/sync') {
      const apiKey = extractBearerToken(req);
      if (!apiKey || !store.apiKeys.has(apiKey)) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const body = (await readJsonBody(req)) as CloudSyncRequest;
      if (!body.orgId || !Array.isArray(body.chunks)) {
        sendJson(res, 400, { error: 'orgId and chunks are required' });
        return;
      }

      // Validate org exists
      const orgId = store.apiKeys.get(apiKey);
      if (!orgId || !store.orgs.has(orgId)) {
        sendJson(res, 403, { error: 'Forbidden — org not found for this API key' });
        return;
      }

      let synced = 0;
      const now = new Date().toISOString();
      for (const chunk of body.chunks) {
        if (!CLOUD_SYNC_TIERS.has(chunk.trustTier)) continue; // only accept institutional/canonical
        const key = `${orgId}:${chunk.contentHash}`;
        store.chunks.set(key, {
          contentHash: chunk.contentHash,
          orgId,
          workspaceId: body.workspaceId,
          title: chunk.title,
          body: chunk.body,
          trustTier: chunk.trustTier as 'institutional' | 'canonical',
          sourcePath: chunk.sourcePath,
          promotedAt: chunk.promotedAt,
          syncedAt: now,
        });
        synced++;
      }

      const response: CloudSyncResponse = { synced };
      sendJson(res, 200, response);
      return;
    }

    // ── GET /search ───────────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/search') {
      const apiKey = extractBearerToken(req);
      if (!apiKey || !store.apiKeys.has(apiKey)) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const q = url.searchParams.get('q') ?? '';
      const orgId = url.searchParams.get('orgId') ?? store.apiKeys.get(apiKey) ?? '';

      if (!q.trim()) {
        sendJson(res, 400, { error: 'q query parameter is required' });
        return;
      }

      // Simple in-memory text search — production would use pgvector semantic search
      const qLower = q.toLowerCase();
      const results: CloudSearchResult[] = [];
      for (const chunk of store.chunks.values()) {
        if (chunk.orgId !== orgId) continue; // Enforce org scope (cross-org requires group membership check)
        const bodyLower = chunk.body.toLowerCase();
        const titleLower = (chunk.title ?? '').toLowerCase();
        if (!bodyLower.includes(qLower) && !titleLower.includes(qLower)) continue;
        results.push({
          contentHash: chunk.contentHash,
          orgId: chunk.orgId,
          workspaceId: chunk.workspaceId,
          title: chunk.title,
          snippet: chunk.body.slice(0, 200),
          trustTier: chunk.trustTier,
          sourcePath: chunk.sourcePath,
          syncedAt: chunk.syncedAt,
        });
      }

      sendJson(res, 200, { results, count: results.length });
      return;
    }

    // ── POST /orgs ────────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/orgs') {
      const apiKey = extractBearerToken(req);
      if (!apiKey || !store.adminKeys.has(apiKey)) {
        sendJson(res, 401, { error: 'Unauthorized — admin API key required' });
        return;
      }

      const body = (await readJsonBody(req)) as { name?: string; slug?: string; entraTenantId?: string; orgApiKey?: string };
      if (!body.name?.trim() || !body.slug?.trim()) {
        sendJson(res, 400, { error: 'name and slug are required' });
        return;
      }

      // Check slug uniqueness
      const slugExists = [...store.orgs.values()].some(o => o.slug === body.slug);
      if (slugExists) {
        sendJson(res, 409, { error: `Org with slug "${body.slug}" already exists` });
        return;
      }

      const org: CloudOrg = {
        id: randomUUID(),
        name: body.name.trim(),
        slug: body.slug.trim(),
        entraTenantId: body.entraTenantId,
        createdAt: new Date().toISOString(),
      };
      store.orgs.set(org.id, org);

      // Register the org's API key if provided
      if (body.orgApiKey) {
        store.apiKeys.set(body.orgApiKey, org.id);
      }

      sendJson(res, 201, { org });
      return;
    }

    // ── GET /orgs/:id/workspaces ──────────────────────────────────────────────
    const orgWorkspacesMatch = /^\/orgs\/([^/]+)\/workspaces$/.exec(url.pathname);
    if (method === 'GET' && orgWorkspacesMatch) {
      const apiKey = extractBearerToken(req);
      if (!apiKey || !store.apiKeys.has(apiKey)) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const orgId = orgWorkspacesMatch[1]!;
      if (!store.orgs.has(orgId)) {
        sendJson(res, 404, { error: `Org "${orgId}" not found` });
        return;
      }

      const workspaces = [...store.workspaces.values()].filter(w => w.orgId === orgId);
      sendJson(res, 200, { workspaces });
      return;
    }

    // ── 404 ───────────────────────────────────────────────────────────────────
    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Server factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns the ctxhub Cloud HTTP server.
 * Does NOT call server.listen() — the caller is responsible for that.
 *
 * @param store — optional store override (defaults to a new in-memory store).
 *   Pass a pre-populated store for testing or for dependency injection.
 */
export function createCloudServer(store?: CloudStore): http.Server {
  const s = store ?? createInMemoryStore();
  const handler = createHandler(s);
  return http.createServer((req, res) => {
    void handler(req, res).catch(error => {
      sendJson(res, 500, { error: (error as Error).message ?? 'Internal server error' });
    });
  });
}
