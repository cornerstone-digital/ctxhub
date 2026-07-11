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

/** Body for POST /sync */
export interface CloudSyncRequest {
  orgId: string;
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
