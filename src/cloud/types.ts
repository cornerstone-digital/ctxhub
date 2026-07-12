/**
 * Shared types for the ctxhub Cloud service (src/cloud/service.ts).
 *
 * These types define the wire format between self-hosted instances (sync client,
 * src/cloud/sync.ts) and the Cloud backend.
 */

// ── Org & Workspace ───────────────────────────────────────────────────────────

export interface CloudOrg {
  id: string;
  name: string;
  slug: string;
  entraTenantId?: string;
  createdAt: string; // ISO timestamp
}

export interface CloudWorkspace {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}

// ── Chunks ────────────────────────────────────────────────────────────────────

/** A promoted chunk stored in the Cloud replica store. */
export interface CloudChunk {
  /** SHA-256 of content — deduplicated key within (orgId, workspaceId). */
  contentHash: string;
  orgId: string;
  workspaceId?: string;
  title?: string;
  body: string;
  trustTier: 'institutional' | 'canonical';
  sourcePath?: string;
  promotedAt?: string;
  syncedAt: string;
}

// ── Sync protocol ─────────────────────────────────────────────────────────────

/** Body for POST /sync. orgId is resolved server-side from the API key, never trusted from
 * the client -- see the orgId-spoofing fix applied to /sync, /sync/events, /sync/runs, and
 * /sync/notes together. */
export interface CloudSyncRequest {
  workspaceId?: string;
  chunks: Array<{
    contentHash: string;
    title?: string;
    body: string;
    trustTier: string;
    sourcePath?: string;
    promotedAt?: string;
  }>;
}

/** Response from POST /sync */
export interface CloudSyncResponse {
  synced: number;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface CloudSearchResult {
  contentHash: string;
  orgId: string;
  workspaceId?: string;
  title?: string;
  snippet: string;
  trustTier: 'institutional' | 'canonical';
  sourcePath?: string;
  syncedAt: string;
  score?: number;
}

// ── Event ingestion ───────────────────────────────────────────────────────────

export interface CloudEvent {
  type: string;
  ts: string;
  orgId: string;
  sub?: string;
  email?: string;
  [key: string]: unknown;
}

export interface CloudCaptainRun {
  id: string;
  orgId: string;
  workspaceId: string;
  taskName: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  findingsCount: number;
  promotedCount: number;
  syncedAt: string;
}

export interface CloudNote {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  content: string;
  promotedAt: string;
  promotedBy: string;
  trustTier: string;
  syncedAt: string;
}

// ── Blueprint registry ───────────────────────────────────────────────────────
// Content-addressed store, keyed by (name, version). `orgId: null` means published
// public (visible to every org); a real orgId means org-private (M8's "org-private
// blueprints" -- gated on this org model existing, which is why it's here and not a
// separate service).

export interface BlueprintRecord {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  /** null = public; a real orgId = visible only to that org */
  orgId: string | null;
  publishedBy: string; // sub of the API key holder, if known, else 'unknown'
  publishedAt: string;
  archiveHash: string; // sha256 of the archive bytes; used as the content-addressed key
  archiveSize: number;
  /** M8 topology-aware blueprints: service types this blueprint applies to, e.g. ['api', 'worker'].
   * Undefined/empty means "applies to any service type" (unfiltered). */
  serviceTypes?: string[];
}

// ── Org Graph: Knowledge Graph (docs/org_graph_architecture.md §3) ─────────────
// In-memory store today, same "architecturally-correct stub, Postgres in production"
// pattern as the rest of this service (see the module doc comment on CloudStore).
// ROADMAP.md M7 originally checked these off with no implementation behind them at
// all -- this is the real thing, built to the ADR-005/006/007/008 decisions.

export type KnowledgeObjectState = 'draft' | 'active' | 'superseded' | 'archived';

export interface CloudKnowledgeObject {
  id: string;
  orgId: string;
  workspaceId: string;
  /** id of the local (per-workspace JSON store) KnowledgeObject this was synced from --
   * the idempotency key for re-sync (ADR-005: workspace-owned, not member-owned). */
  localId: string;
  promotedBy: string; // sub of the promoting member; preserved after member deprovisioning (ADR-005)
  promotedAt: string;
  title: string;
  body: string;
  query?: string; // captain query that produced this finding
  agent?: string; // LLM agent name
  state: KnowledgeObjectState;
  supersededBy?: string; // id of the KnowledgeObject that replaced this one
  archivedAt?: string;
  archiveReason?: string;
  /** Starts at 1.0 on promotion; organisational signal only, never LLM self-assessed (ADR-008). */
  confidence: number;
  corroborations: number;
  reviewFlag: boolean;
  conceptIds: string[];
  syncedAt: string;
}

export type KnowledgeEdgeType = 'superseded_by' | 'related_to' | 'contradicts';

export interface CloudKnowledgeEdge {
  id: string;
  orgId: string;
  fromId: string;
  toId: string;
  edgeType: KnowledgeEdgeType;
  createdBy: string; // 'human' | 'auto', or a member sub
  createdAt: string;
}

export interface CloudConcept {
  id: string;
  orgId: string;
  name: string;
}

// ── Org Graph: Engineering Topology Graph (docs/org_graph_architecture.md §4) ──

export interface CloudTopologyRepository {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  gitRemote?: string;
}

export interface CloudTopologyService {
  id: string;
  orgId: string;
  name: string;
  /** M8 topology-aware blueprints match on this, e.g. 'api', 'worker', 'frontend'. */
  serviceType?: string;
  description?: string;
  createdBy?: string;
}

export type TopologyNodeType = 'workspace' | 'repository' | 'service' | 'member';
export type TopologyEdgeType = 'contains' | 'depends_on' | 'owned_by' | 'part_of' | 'calls';

export interface CloudTopologyEdge {
  id: string;
  orgId: string;
  fromType: TopologyNodeType;
  fromId: string;
  toType: TopologyNodeType;
  toId: string;
  edgeType: TopologyEdgeType;
  basis: 'inferred' | 'manual';
  createdBy?: string;
  createdAt: string;
}

// ── Org Graph: Cascade Rules (docs/org_graph_architecture.md §5, ADR-007) ──────

export interface CloudCascadeRule {
  id: string;
  orgId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  /** "topology": derived from a depends_on edge, deleted when that edge is removed.
   * "manual": admin-configured, persists independently of topology. */
  basis: 'topology' | 'manual';
  topologyEdgeId?: string;
  trigger: string; // e.g. "captain.run.promoted" | "confidence.degraded" | "contradiction.detected"
  filterCaptainTask?: string;
  createdBy?: string;
  createdAt: string;
}

// ── Sync protocol: knowledge objects ────────────────────────────────────────────
// Mirrors the chunk/run sync pattern (see CloudSyncRequest above): orgId is always
// resolved server-side from the API key, never trusted from the client.

export interface CloudKnowledgeSyncRequest {
  workspaceId: string;
  objects: Array<{
    localId: string;
    promotedBy: string;
    promotedAt: string;
    title: string;
    body: string;
    query?: string;
    agent?: string;
    state: KnowledgeObjectState;
    confidence: number;
    reviewFlag: boolean;
  }>;
}

export interface CloudKnowledgeSyncResponse {
  synced: number;
}

