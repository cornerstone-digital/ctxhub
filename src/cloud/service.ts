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
  CloudKnowledgeObject,
  CloudKnowledgeEdge,
  CloudConcept,
  CloudTopologyRepository,
  CloudTopologyService,
  CloudTopologyEdge,
  CloudCascadeRule,
  CloudKnowledgeSyncRequest,
  KnowledgeObjectState,
  KnowledgeEdgeType,
  TopologyNodeType,
  TopologyEdgeType,
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
  // Org Graph (docs/org_graph_architecture.md) — Knowledge Graph
  knowledgeObjects: Map<string, CloudKnowledgeObject>; // key: `${orgId}:${workspaceId}:${localId}` for sync idempotency
  knowledgeEdges: CloudKnowledgeEdge[];
  concepts: Map<string, CloudConcept>; // key: `${orgId}:${name}`
  // Org Graph — Engineering Topology Graph
  topologyRepositories: Map<string, CloudTopologyRepository>;
  topologyServices: Map<string, CloudTopologyService>;
  topologyEdges: Map<string, CloudTopologyEdge>;
  // Org Graph — Cascade Rules (ADR-007)
  cascadeRules: Map<string, CloudCascadeRule>;
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
    knowledgeObjects: new Map(),
    knowledgeEdges: [],
    concepts: new Map(),
    topologyRepositories: new Map(),
    topologyServices: new Map(),
    topologyEdges: new Map(),
    cascadeRules: new Map(),
  };
  if (bootstrapAdminKey) store.adminKeys.add(bootstrapAdminKey);
  return store;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * M8 topology-aware blueprints: resolve a workspace to the service type(s) it maps to via
 * the topology graph (workspace -contains-> repository -part_of-> service), so the Blueprint
 * Hub can filter to blueprints declared relevant to that workspace's service type. A workspace
 * with no topology registered (most workspaces, since topology registration is opt-in) simply
 * resolves to no service types, which means no serviceType-based filtering is applied.
 */
function resolveWorkspaceServiceTypes(store: CloudStore, orgId: string, workspaceId: string): string[] {
  const repoIds = [...store.topologyRepositories.values()]
    .filter(r => r.orgId === orgId && r.workspaceId === workspaceId)
    .map(r => r.id);
  if (repoIds.length === 0) return [];

  const serviceIds = [...store.topologyEdges.values()]
    .filter(e => e.orgId === orgId && e.edgeType === 'part_of' && e.fromType === 'repository' && repoIds.includes(e.fromId) && e.toType === 'service')
    .map(e => e.toId);

  const types = new Set<string>();
  for (const serviceId of serviceIds) {
    const service = store.topologyServices.get(serviceId);
    if (service?.serviceType) types.add(service.serviceType);
  }
  return [...types];
}

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
        serviceTypes?: string[]; public?: boolean; archiveBase64?: string; publishedBy?: string;
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
        serviceTypes: body.serviceTypes,
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
    // simple name/description/tag substring search, and M8 topology-aware filtering via
    // ?serviceType= directly or ?workspace= (resolved to service type(s) via the topology
    // graph). A blueprint with no serviceTypes declared always matches -- serviceTypes is an
    // opt-in narrowing, not a requirement every blueprint must declare.
    if (method === 'GET' && url.pathname === '/blueprints') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const workspaceParam = url.searchParams.get('workspace') ?? undefined;
      const explicitServiceType = url.searchParams.get('serviceType') ?? undefined;
      const serviceTypes = explicitServiceType
        ? [explicitServiceType]
        : workspaceParam
          ? resolveWorkspaceServiceTypes(store, orgId, workspaceParam)
          : [];

      let visible = [...store.blueprints.values()].filter(bp => bp.orgId === null || bp.orgId === orgId);
      if (serviceTypes.length > 0) {
        visible = visible.filter(bp => !bp.serviceTypes?.length || bp.serviceTypes.some(t => serviceTypes.includes(t)));
      }
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

    // ═══════════════════════════════════════════════════════════════════════════
    // Org Graph — docs/org_graph_architecture.md, ADR-005 through ADR-009.
    // Same in-memory-stub pattern as the rest of this file (see the CloudStore doc
    // comment): real, tested, working logic, running on Maps/arrays instead of the
    // Postgres schema the architecture doc describes. ROADMAP.md M7 originally
    // checked these routes off with nothing behind them at all -- this is the real
    // implementation, corrected on 2026-07-12.
    //
    // Not implemented (documented gaps, not silent omissions):
    //   - pgvector semantic similarity / auto-derived related_to edges (ADR-009 Phase 2 —
    //     explicitly gated on 500+ active objects and real semantic-search demand)
    //   - confidence decay from git-diff file-change tracking (ADR-008) — needs a background
    //     job correlating topology_repositories to real git history, not built here
    //   - actual cascade *propagation* (enqueuing a captain run in the target workspace when
    //     captain.run.promoted fires) — the cascade_rules table and its derivation from
    //     topology exist and are correct, but nothing consumes the rules yet; that is
    //     Engineering Intelligence territory (M10), which explicitly depends on this milestone
    //     being live with real data first
    //   - the Mission Control force-directed graph view (architecture doc §8) — the ROADMAP
    //     checkbox asks for "browse and search... filter by state and confidence", which is
    //     what got built (OrgKnowledgeView.tsx); the full graph visualisation is a larger,
    //     separate UI investment
    // ═══════════════════════════════════════════════════════════════════════════

    // ── POST /sync/knowledge ──────────────────────────────────────────────────
    // Self-hosted instances push locally-promoted Knowledge Objects (src/knowledge/store.ts)
    // here. Idempotent on (workspaceId, localId) so re-syncing after a local edit updates the
    // existing Cloud record rather than duplicating it. Confidence/corroborations/reviewFlag
    // set by contradiction/reaffirm (ADR-008) are Cloud-computed and NOT overwritten by a local
    // re-sync, except reviewFlag which is OR'd — either side raising it is enough to flag it.
    if (method === 'POST' && url.pathname === '/sync/knowledge') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const body = (await readJsonBody(req)) as CloudKnowledgeSyncRequest;
      if (!body.workspaceId || !Array.isArray(body.objects)) {
        sendJson(res, 400, { error: 'workspaceId and objects are required' });
        return;
      }

      const now = new Date().toISOString();
      let synced = 0;
      for (const o of body.objects) {
        if (!o.localId || !o.title?.trim() || !o.body?.trim()) continue;
        // Keyed by orgId too, not just (workspaceId, localId) -- workspace names/IDs are
        // client-chosen strings that can coincidentally collide across two different orgs.
        const key = `${orgId}:${body.workspaceId}:${o.localId}`;
        const existing = store.knowledgeObjects.get(key);
        store.knowledgeObjects.set(key, {
          id: existing?.id ?? randomUUID(),
          orgId,
          workspaceId: body.workspaceId,
          localId: o.localId,
          promotedBy: o.promotedBy,
          promotedAt: o.promotedAt,
          title: o.title,
          body: o.body,
          query: o.query,
          agent: o.agent,
          state: o.state,
          supersededBy: existing?.supersededBy,
          archivedAt: existing?.archivedAt,
          archiveReason: existing?.archiveReason,
          confidence: existing?.confidence ?? o.confidence,
          corroborations: existing?.corroborations ?? 0,
          reviewFlag: (existing?.reviewFlag ?? false) || o.reviewFlag,
          conceptIds: existing?.conceptIds ?? [],
          syncedAt: now,
        });
        synced++;
      }

      sendJson(res, 200, { synced });
      return;
    }

    // ── GET /knowledge — cross-workspace query ────────────────────────────────
    // The M7 exit condition: "an org with 3+ workspaces queries 'what do we know about X?'
    // and gets findings from all workspaces, ranked by confidence, with provenance shown."
    if (method === 'GET' && url.pathname === '/knowledge') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const workspaceFilter = url.searchParams.get('workspace') ?? undefined;
      const stateFilter = url.searchParams.get('state') as KnowledgeObjectState | null;
      const conceptFilter = url.searchParams.get('concept') ?? undefined;
      const minConfidenceRaw = url.searchParams.get('minConfidence');

      let objects = [...store.knowledgeObjects.values()].filter(o => o.orgId === orgId);
      if (workspaceFilter) objects = objects.filter(o => o.workspaceId === workspaceFilter);
      if (stateFilter) objects = objects.filter(o => o.state === stateFilter);
      if (conceptFilter) objects = objects.filter(o => o.conceptIds.includes(conceptFilter));
      if (minConfidenceRaw) objects = objects.filter(o => o.confidence >= Number(minConfidenceRaw));
      if (q) objects = objects.filter(o => o.title.toLowerCase().includes(q) || o.body.toLowerCase().includes(q));

      objects.sort((a, b) => b.confidence - a.confidence || b.promotedAt.localeCompare(a.promotedAt));

      sendJson(res, 200, { objects, count: objects.length });
      return;
    }

    // ── GET/PATCH /knowledge/:id ──────────────────────────────────────────────
    const knowledgeObjectMatch = /^\/knowledge\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && knowledgeObjectMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const id = knowledgeObjectMatch[1]!;
      const object = [...store.knowledgeObjects.values()].find(o => o.id === id && o.orgId === orgId);
      if (!object) {
        sendJson(res, 404, { error: 'Knowledge object not found' });
        return;
      }
      const edges = store.knowledgeEdges.filter(e => e.orgId === orgId && (e.fromId === id || e.toId === id));
      sendJson(res, 200, { object, edges });
      return;
    }

    if (method === 'PATCH' && knowledgeObjectMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const id = knowledgeObjectMatch[1]!;
      const entry = [...store.knowledgeObjects.entries()].find(([, o]) => o.id === id && o.orgId === orgId);
      if (!entry) {
        sendJson(res, 404, { error: 'Knowledge object not found' });
        return;
      }
      const [key, object] = entry;

      const body = (await readJsonBody(req)) as { action?: string; supersededBy?: string; reason?: string };
      const now = new Date().toISOString();

      if (body.action === 'supersede') {
        if (!body.supersededBy) {
          sendJson(res, 400, { error: 'supersededBy is required to supersede' });
          return;
        }
        object.state = 'superseded';
        object.supersededBy = body.supersededBy;
        store.knowledgeEdges.push({
          id: randomUUID(), orgId, fromId: id, toId: body.supersededBy,
          edgeType: 'superseded_by', createdBy: 'human', createdAt: now,
        });
      } else if (body.action === 'archive') {
        object.state = 'archived';
        object.archivedAt = now;
        object.archiveReason = body.reason;
      } else if (body.action === 'reaffirm') {
        // ADR-008: an engineer explicitly marking a finding "still accurate" is a
        // corroboration signal, distinct from and not derived from model confidence.
        object.reviewFlag = false;
        object.confidence = Math.min(1, object.confidence + 0.1);
        object.corroborations += 1;
      } else if (body.action === 'flag') {
        object.reviewFlag = true;
      } else {
        sendJson(res, 400, { error: 'action must be one of: supersede, archive, reaffirm, flag' });
        return;
      }

      store.knowledgeObjects.set(key, object);
      sendJson(res, 200, { object });
      return;
    }

    // ── GET/POST /knowledge/:id/edges ─────────────────────────────────────────
    const knowledgeEdgesMatch = /^\/knowledge\/([^/]+)\/edges$/.exec(url.pathname);
    if (method === 'GET' && knowledgeEdgesMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const id = knowledgeEdgesMatch[1]!;
      const edges = store.knowledgeEdges.filter(e => e.orgId === orgId && (e.fromId === id || e.toId === id));
      sendJson(res, 200, { edges });
      return;
    }

    if (method === 'POST' && knowledgeEdgesMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }

      const fromId = knowledgeEdgesMatch[1]!;
      if (![...store.knowledgeObjects.values()].some(o => o.id === fromId && o.orgId === orgId)) {
        sendJson(res, 404, { error: 'Knowledge object not found' });
        return;
      }

      const body = (await readJsonBody(req)) as { toId?: string; edgeType?: KnowledgeEdgeType };
      if (!body.toId || !body.edgeType) {
        sendJson(res, 400, { error: 'toId and edgeType are required' });
        return;
      }
      const toEntry = [...store.knowledgeObjects.entries()].find(([, o]) => o.id === body.toId && o.orgId === orgId);
      if (!toEntry) {
        sendJson(res, 400, { error: `toId "${body.toId}" not found` });
        return;
      }

      const now = new Date().toISOString();
      const edge: CloudKnowledgeEdge = {
        id: randomUUID(), orgId, fromId, toId: body.toId, edgeType: body.edgeType,
        createdBy: 'human', createdAt: now,
      };
      store.knowledgeEdges.push(edge);

      // ADR-008: a contradiction decreases confidence and flags the contradicted (target)
      // object for review. "This one" in the ADR's wording is the object being contradicted.
      if (body.edgeType === 'contradicts') {
        const [toKey, toObject] = toEntry;
        toObject.confidence = Math.max(0, toObject.confidence - 0.3);
        toObject.reviewFlag = true;
        store.knowledgeObjects.set(toKey, toObject);
      }

      sendJson(res, 201, { edge });
      return;
    }

    // ── GET/POST /concepts, POST /knowledge/:id/concepts ──────────────────────
    if (method === 'GET' && url.pathname === '/concepts') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const concepts = [...store.concepts.values()].filter(c => c.orgId === orgId);
      sendJson(res, 200, { concepts });
      return;
    }

    if (method === 'POST' && url.pathname === '/concepts') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const body = (await readJsonBody(req)) as { name?: string };
      if (!body.name?.trim()) {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }
      const name = body.name.trim();
      const key = `${orgId}:${name}`;
      let concept = store.concepts.get(key);
      if (!concept) {
        concept = { id: randomUUID(), orgId, name };
        store.concepts.set(key, concept);
      }
      sendJson(res, 200, { concept });
      return;
    }

    const linkConceptMatch = /^\/knowledge\/([^/]+)\/concepts$/.exec(url.pathname);
    if (method === 'POST' && linkConceptMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const id = linkConceptMatch[1]!;
      const entry = [...store.knowledgeObjects.entries()].find(([, o]) => o.id === id && o.orgId === orgId);
      if (!entry) {
        sendJson(res, 404, { error: 'Knowledge object not found' });
        return;
      }
      const body = (await readJsonBody(req)) as { conceptId?: string };
      if (!body.conceptId) {
        sendJson(res, 400, { error: 'conceptId is required' });
        return;
      }
      const [key, object] = entry;
      if (!object.conceptIds.includes(body.conceptId)) {
        object.conceptIds.push(body.conceptId);
        store.knowledgeObjects.set(key, object);
      }
      sendJson(res, 200, { object });
      return;
    }

    // ── GET/POST /topology/repositories ───────────────────────────────────────
    if (method === 'GET' && url.pathname === '/topology/repositories') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const repositories = [...store.topologyRepositories.values()].filter(r => r.orgId === orgId);
      sendJson(res, 200, { repositories });
      return;
    }

    if (method === 'POST' && url.pathname === '/topology/repositories') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const body = (await readJsonBody(req)) as { workspaceId?: string; name?: string; gitRemote?: string };
      if (!body.workspaceId || !body.name?.trim()) {
        sendJson(res, 400, { error: 'workspaceId and name are required' });
        return;
      }
      const repository: CloudTopologyRepository = {
        id: randomUUID(), orgId, workspaceId: body.workspaceId, name: body.name.trim(), gitRemote: body.gitRemote,
      };
      store.topologyRepositories.set(repository.id, repository);
      sendJson(res, 201, { repository });
      return;
    }

    // ── GET/POST /topology/services ───────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/topology/services') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const serviceTypeFilter = url.searchParams.get('serviceType') ?? undefined;
      let services = [...store.topologyServices.values()].filter(s => s.orgId === orgId);
      if (serviceTypeFilter) services = services.filter(s => s.serviceType === serviceTypeFilter);
      sendJson(res, 200, { services });
      return;
    }

    if (method === 'POST' && url.pathname === '/topology/services') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const body = (await readJsonBody(req)) as { name?: string; serviceType?: string; description?: string; createdBy?: string };
      if (!body.name?.trim()) {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }
      const service: CloudTopologyService = {
        id: randomUUID(), orgId, name: body.name.trim(), serviceType: body.serviceType,
        description: body.description, createdBy: body.createdBy,
      };
      store.topologyServices.set(service.id, service);
      sendJson(res, 201, { service });
      return;
    }

    // ── POST /topology/edges — auto-derives cascade rules (ADR-007) ──────────
    if (method === 'POST' && url.pathname === '/topology/edges') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const body = (await readJsonBody(req)) as {
        fromType?: TopologyNodeType; fromId?: string; toType?: TopologyNodeType; toId?: string;
        edgeType?: TopologyEdgeType; basis?: 'inferred' | 'manual'; createdBy?: string;
      };
      if (!body.fromType || !body.fromId || !body.toType || !body.toId || !body.edgeType) {
        sendJson(res, 400, { error: 'fromType, fromId, toType, toId, and edgeType are required' });
        return;
      }

      const now = new Date().toISOString();
      const edge: CloudTopologyEdge = {
        id: randomUUID(), orgId, fromType: body.fromType, fromId: body.fromId, toType: body.toType, toId: body.toId,
        edgeType: body.edgeType, basis: body.basis ?? 'manual', createdBy: body.createdBy, createdAt: now,
      };
      store.topologyEdges.set(edge.id, edge);

      // ADR-007: a depends_on edge between two workspaces auto-derives a cascade rule with
      // zero configuration. Only workspace-to-workspace depends_on edges qualify — that is
      // the edge type the architecture doc defines cascade derivation over.
      let cascadeRule: CloudCascadeRule | undefined;
      if (body.edgeType === 'depends_on' && body.fromType === 'workspace' && body.toType === 'workspace') {
        cascadeRule = {
          id: randomUUID(), orgId, sourceWorkspaceId: body.fromId, targetWorkspaceId: body.toId,
          basis: 'topology', topologyEdgeId: edge.id, trigger: 'captain.run.promoted', createdAt: now,
        };
        store.cascadeRules.set(cascadeRule.id, cascadeRule);
      }

      sendJson(res, 201, { edge, cascadeRule });
      return;
    }

    // ── DELETE /topology/edges/:id — cascades deletion of derived rules (ADR-007) ─
    const topologyEdgeDeleteMatch = /^\/topology\/edges\/([^/]+)$/.exec(url.pathname);
    if (method === 'DELETE' && topologyEdgeDeleteMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const id = topologyEdgeDeleteMatch[1]!;
      const edge = store.topologyEdges.get(id);
      if (!edge || edge.orgId !== orgId) {
        sendJson(res, 404, { error: 'Topology edge not found' });
        return;
      }
      store.topologyEdges.delete(id);

      let deletedCascadeRules = 0;
      for (const [ruleId, rule] of store.cascadeRules) {
        if (rule.orgId === orgId && rule.basis === 'topology' && rule.topologyEdgeId === id) {
          store.cascadeRules.delete(ruleId);
          deletedCascadeRules++;
        }
      }

      sendJson(res, 200, { deleted: true, deletedCascadeRules });
      return;
    }

    // ── GET/POST /cascade-rules, DELETE /cascade-rules/:id ────────────────────
    if (method === 'GET' && url.pathname === '/cascade-rules') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const rules = [...store.cascadeRules.values()].filter(r => r.orgId === orgId);
      sendJson(res, 200, { rules });
      return;
    }

    if (method === 'POST' && url.pathname === '/cascade-rules') {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const body = (await readJsonBody(req)) as {
        sourceWorkspaceId?: string; targetWorkspaceId?: string; trigger?: string;
        filterCaptainTask?: string; createdBy?: string;
      };
      if (!body.sourceWorkspaceId || !body.targetWorkspaceId || !body.trigger) {
        sendJson(res, 400, { error: 'sourceWorkspaceId, targetWorkspaceId, and trigger are required' });
        return;
      }
      const rule: CloudCascadeRule = {
        id: randomUUID(), orgId, sourceWorkspaceId: body.sourceWorkspaceId, targetWorkspaceId: body.targetWorkspaceId,
        basis: 'manual', trigger: body.trigger, filterCaptainTask: body.filterCaptainTask,
        createdBy: body.createdBy, createdAt: new Date().toISOString(),
      };
      store.cascadeRules.set(rule.id, rule);
      sendJson(res, 201, { rule });
      return;
    }

    const cascadeRuleDeleteMatch = /^\/cascade-rules\/([^/]+)$/.exec(url.pathname);
    if (method === 'DELETE' && cascadeRuleDeleteMatch) {
      const apiKey = extractBearerToken(req);
      const orgId = apiKey ? store.apiKeys.get(apiKey) : undefined;
      if (!apiKey || !orgId) {
        sendJson(res, 401, { error: 'Unauthorized — invalid or missing API key' });
        return;
      }
      const id = cascadeRuleDeleteMatch[1]!;
      const rule = store.cascadeRules.get(id);
      if (!rule || rule.orgId !== orgId) {
        sendJson(res, 404, { error: 'Cascade rule not found' });
        return;
      }
      if (rule.basis !== 'manual') {
        sendJson(res, 400, {
          error: 'Only manual cascade rules can be deleted directly — topology-derived rules are removed by deleting their source topology edge',
        });
        return;
      }
      store.cascadeRules.delete(id);
      sendJson(res, 200, { deleted: true });
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
