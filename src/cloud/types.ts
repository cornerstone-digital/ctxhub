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
}

