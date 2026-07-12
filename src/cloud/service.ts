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
import { randomUUID, createHash } from 'node:crypto';
import { getPackageVersion } from '../utils/version.js';
import type {
  CloudChunk,
  CloudOrg,
  CloudWorkspace,
  CloudSyncRequest,
  CloudSyncResponse,
  CloudSearchResult,
  CloudEvent,
  CloudCaptainRun,
  CloudNote,
  BlueprintRecord,
} from './types.js';

// ── In-memory store ───────────────────────────────────────────────────────────

export interface CloudStore {
  chunks: Map<string, CloudChunk>;     // key: `${orgId}:${contentHash}`
  orgs: Map<string, CloudOrg>;         // key: org.id
  workspaces: Map<string, CloudWorkspace>; // key: workspace.id
  apiKeys: Map<string, string>;        // key: apiKey → orgId
  adminKeys: Set<string>;              // admin API keys
  events: CloudEvent[];
  runs: CloudCaptainRun[];
  notes: CloudNote[];
  blueprints: Map<string, BlueprintRecord>;  // key: `${name}@${version}`
  blueprintArchives: Map<string, Buffer>;    // key: archiveHash (sha256)
}

/**
 * @param bootstrapAdminKey — seeds `adminKeys` so the very first `POST /orgs` call has
 *   somewhere to start from. Without this there is no way to create an org on a freshly
 *   started service outside of tests (which poke `store.adminKeys` directly) — real
 *   deployments need a key handed to them out of band (env var, secret store, etc).
 */
export function createInMemoryStore(bootstrapAdminKey?: string): CloudStore {
  const store: CloudStore = {
    chunks: new Map(),
    orgs: new Map(),
    workspaces: new Map(),
    apiKeys: new Map(),
    adminKeys: new Set(),
    events: [],
    runs: [],
    notes: [],
    blueprints: new Map(),
    blueprintArchives: new Map(),
  };
  if (bootstrapAdminKey) store.adminKeys.add(bootstrapAdminKey);
  return store;
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
      if (!Array.isArray(body.chunks)) {
        sendJson(res, 400, { error: 'chunks is required' });
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

    // ── POST /blueprints ──────────────────────────────────────────────────────
    // Publish a blueprint. Archive travels as base64 in the JSON body rather than a
    // separate multipart upload -- keeps this route consistent with every other route in
    // this file (JSON in, JSON out) and blueprints are small (docs/personas/task configs,
    // not binaries). `public: true` publishes to every org; omitted/false publishes
    // org-private, visible only to the caller's own org (M8's "org-private blueprints").
    if (method === 'POST' && url.pathname === '/blueprints') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const body = (await readJsonBody(req)) as {
        name?: string; version?: string; description?: string; author?: string; tags?: string[];
        public?: boolean; archiveBase64?: string; publishedBy?: string;
      };
      if (!body.name?.trim() || !body.version?.trim() || !body.description?.trim() || !body.archiveBase64) {
        sendJson(res, 400, { error: 'name, version, description, and archiveBase64 are required' });
        return;
      }

      const archive = Buffer.from(body.archiveBase64, 'base64');
      const archiveHash = createHash('sha256').update(archive).digest('hex');
      const key = `${body.name.trim()}@${body.version.trim()}`;

      if (store.blueprints.has(key)) {
        sendJson(res, 409, { error: `${key} is already published. Publish a new version instead of overwriting.` });
        return;
      }

      const record: BlueprintRecord = {
        name: body.name.trim(),
        version: body.version.trim(),
        description: body.description.trim(),
        author: body.author,
        tags: body.tags,
        orgId: body.public ? null : orgId,
        publishedBy: body.publishedBy ?? 'unknown',
        publishedAt: new Date().toISOString(),
        archiveHash,
        archiveSize: archive.length,
      };
      store.blueprints.set(key, record);
      store.blueprintArchives.set(archiveHash, archive);

      sendJson(res, 201, { blueprint: record });
      return;
    }

    // ── GET /blueprints ────────────────────────────────────────────────────────
    // Lists public blueprints plus the caller's own org-private ones. Supports ?q= for a
    // simple name/description/tag substring search.
    if (method === 'GET' && url.pathname === '/blueprints') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const visible = [...store.blueprints.values()].filter(bp => bp.orgId === null || bp.orgId === orgId);
      const matched = q
        ? visible.filter(bp =>
            bp.name.toLowerCase().includes(q) ||
            bp.description.toLowerCase().includes(q) ||
            (bp.tags ?? []).some(t => t.toLowerCase().includes(q))
          )
        : visible;

      sendJson(res, 200, { blueprints: matched });
      return;
    }

    // ── GET /blueprints/:name/:version ────────────────────────────────────────
    const blueprintGetMatch = /^\/blueprints\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && blueprintGetMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const record = store.blueprints.get(`${decodeURIComponent(blueprintGetMatch[1]!)}@${decodeURIComponent(blueprintGetMatch[2]!)}`);
      if (!record || (record.orgId !== null && record.orgId !== orgId)) {
        sendJson(res, 404, { error: 'Blueprint not found' });
        return;
      }
      sendJson(res, 200, { blueprint: record });
      return;
    }

    // ── GET /blueprints/:name/:version/download ───────────────────────────────
    const blueprintDownloadMatch = /^\/blueprints\/([^/]+)\/([^/]+)\/download$/.exec(url.pathname);
    if (method === 'GET' && blueprintDownloadMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const record = store.blueprints.get(`${decodeURIComponent(blueprintDownloadMatch[1]!)}@${decodeURIComponent(blueprintDownloadMatch[2]!)}`);
      if (!record || (record.orgId !== null && record.orgId !== orgId)) {
        sendJson(res, 404, { error: 'Blueprint not found' });
        return;
      }
      const archive = store.blueprintArchives.get(record.archiveHash);
      if (!archive) {
        sendJson(res, 500, { error: 'Blueprint record exists but its archive is missing from the store' });
        return;
      }
      sendJson(res, 200, { archiveBase64: archive.toString('base64'), archiveHash: record.archiveHash });
      return;
    }

    // ── POST /sync/events ─────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/sync/events') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const body = (await readJsonBody(req)) as { events?: unknown[] };
      if (!Array.isArray(body.events)) {
        sendJson(res, 400, { error: 'events is required' });
        return;
      }

      const now = new Date().toISOString();
      let accepted = 0;
      for (const ev of body.events) {
        if (typeof ev !== 'object' || ev === null) continue;
        const e = ev as Record<string, unknown>;
        store.events.push({
          ...e,
          type: String(e['type'] ?? ''),
          ts: String(e['ts'] ?? now),
          orgId,
          sub: e['sub'] !== undefined ? String(e['sub']) : undefined,
          email: e['email'] !== undefined ? String(e['email']) : undefined,
        } as CloudEvent);
        accepted++;
      }
      console.log(`Accepted ${accepted} events from org ${orgId}`);
      sendJson(res, 200, { accepted });
      return;
    }

    // ── POST /sync/runs ───────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/sync/runs') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const body = (await readJsonBody(req)) as { workspaceId?: string; runs?: unknown[] };
      if (!body.workspaceId || !Array.isArray(body.runs)) {
        sendJson(res, 400, { error: 'workspaceId and runs are required' });
        return;
      }

      const now = new Date().toISOString();
      let accepted = 0;
      for (const r of body.runs) {
        if (typeof r !== 'object' || r === null) continue;
        const run = r as Record<string, unknown>;
        store.runs.push({
          id: String(run['id'] ?? ''),
          orgId,
          workspaceId: body.workspaceId,
          taskName: String(run['taskName'] ?? ''),
          startedAt: String(run['startedAt'] ?? now),
          completedAt: run['completedAt'] !== undefined ? String(run['completedAt']) : undefined,
          status: (run['status'] as 'running' | 'completed' | 'failed') ?? 'completed',
          findingsCount: Number(run['findingsCount'] ?? 0),
          promotedCount: Number(run['promotedCount'] ?? 0),
          syncedAt: now,
        });
        accepted++;
      }
      sendJson(res, 200, { accepted });
      return;
    }

    // ── POST /sync/notes ──────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/sync/notes') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const body = (await readJsonBody(req)) as { workspaceId?: string; notes?: unknown[] };
      if (!body.workspaceId || !Array.isArray(body.notes)) {
        sendJson(res, 400, { error: 'workspaceId and notes are required' });
        return;
      }

      const now = new Date().toISOString();
      let accepted = 0;
      for (const n of body.notes) {
        if (typeof n !== 'object' || n === null) continue;
        const note = n as Record<string, unknown>;
        store.notes.push({
          id: String(note['id'] ?? ''),
          orgId,
          workspaceId: body.workspaceId,
          title: String(note['title'] ?? ''),
          content: String(note['content'] ?? ''),
          promotedAt: String(note['promotedAt'] ?? now),
          promotedBy: String(note['promotedBy'] ?? ''),
          trustTier: String(note['trustTier'] ?? 'institutional'),
          syncedAt: now,
        });
        accepted++;
      }
      sendJson(res, 200, { accepted });
      return;
    }

    // ── GET /sync/history ─────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/sync/history') {
      const apiKey = extractBearerToken(req);
      // Always resolved from the API key, never from a client-supplied orgId param -- an
      // earlier version trusted `?orgId=` directly, letting any valid key read any org's
      // synced runs/notes/events. Fixed alongside the matching write-side issue above.
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 200);
      const type = url.searchParams.get('type') ?? 'all';

      const events = (type === 'all' || type === 'events')
        ? store.events.filter(e => e.orgId === orgId).slice(-limit)
        : [];
      const runs = (type === 'all' || type === 'runs')
        ? store.runs.filter(r => r.orgId === orgId).slice(-limit)
        : [];
      const notes = (type === 'all' || type === 'notes')
        ? store.notes.filter(n => n.orgId === orgId).slice(-limit)
        : [];

      sendJson(res, 200, { events, runs, notes });
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
