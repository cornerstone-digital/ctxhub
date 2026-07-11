/**
 * ctxhub Cloud sync client — stub implementation.
 *
 * Self-hosted instances use this module to push promoted chunks to the ctxhub Cloud service.
 * The actual cloud endpoint does not exist yet; this stub defines the protocol types and
 * the wire format so the CLI flag (`ctxhub sync --to-cloud`) works end-to-end once the
 * endpoint is live. When the endpoint is not configured, sync silently skips.
 *
 * Only chunks at trust tier `institutional` or `canonical` are sent to Cloud (ADR-009).
 */

import type { IndexedDocument } from '../config/types.js';

// ── Protocol types ────────────────────────────────────────────────────────────

export interface SyncConfig {
  /** Base URL of the ctxhub Cloud API, e.g. https://cloud.ctxhub.io */
  endpoint: string;
  /** API key for authenticating push requests (Bearer token). */
  apiKey: string;
  /** Workspace identifier as registered in Cloud. */
  workspaceId?: string;
}

export interface SyncPayload {
  /** Workspace identifier; may be absent for anonymous/unregistered workspaces. */
  workspaceId?: string;
  /** Chunks being pushed. Only institutional/canonical tiers are included. */
  chunks: Array<{
    contentHash: string;
    title?: string;
    body: string;
    trustTier: string;
    sourcePath?: string;
    promotedAt?: string;
  }>;
  /** ISO timestamp of this sync run. */
  syncedAt: string;
}

export interface SyncResult {
  /** True when sync was skipped (not configured or filtered to zero chunks). */
  skipped?: boolean;
  /** Human-readable reason for skipping. */
  reason?: string;
  /** Number of chunks successfully ingested by Cloud. */
  synced?: number;
  /** Number of chunks that failed to ingest. */
  failed?: number;
  /** Per-chunk error messages for any failed chunks. */
  errors?: string[];
}

// ── Tier filtering ────────────────────────────────────────────────────────────

const CLOUD_SYNC_TIERS = new Set(['institutional', 'canonical']);

function isCloudSyncEligible(chunk: IndexedDocument): boolean {
  return CLOUD_SYNC_TIERS.has(chunk.trustTier ?? '');
}

// ── getSyncConfig ─────────────────────────────────────────────────────────────

/**
 * Reads cloud sync configuration from environment variables or the cloud config file.
 * Environment variables take precedence over the file.
 *
 * Environment variables:
 *   CTXHUB_CLOUD_ENDPOINT — base URL of the Cloud API
 *   CTXHUB_CLOUD_API_KEY  — API key for authentication
 */
export async function getSyncConfig(): Promise<SyncConfig | null> {
  const envEndpoint = process.env['CTXHUB_CLOUD_ENDPOINT'];
  const envApiKey = process.env['CTXHUB_CLOUD_API_KEY'];

  if (envEndpoint && envApiKey) {
    return { endpoint: envEndpoint, apiKey: envApiKey };
  }

  // Try the cloud config file
  try {
    const { getCloudConfigPath, loadCloudConfig } = await import('../commands/cloud.js');
    void getCloudConfigPath; // ensure import side-effects
    const fileConfig = await loadCloudConfig();
    if (fileConfig?.endpoint && fileConfig?.apiKey) {
      return {
        endpoint: fileConfig.endpoint,
        apiKey: fileConfig.apiKey,
      };
    }
  } catch {
    // Cloud config not available — fall through
  }

  if (envEndpoint && !envApiKey) {
    // Endpoint configured but no key — can't authenticate
    return null;
  }

  return null;
}

// ── syncToCloud ───────────────────────────────────────────────────────────────

/**
 * Push promoted chunks to ctxhub Cloud.
 *
 * When `config.endpoint` is not set, returns a skipped result immediately.
 * Only chunks at `institutional` or `canonical` trust tier are included in the payload.
 */
export async function syncToCloud(
  config: SyncConfig,
  chunks: IndexedDocument[],
): Promise<SyncResult> {
  if (!config.endpoint) {
    return { skipped: true, reason: 'cloud sync not configured' };
  }

  const eligible = chunks.filter(isCloudSyncEligible);
  if (eligible.length === 0) {
    return { skipped: true, reason: 'no institutional or canonical chunks to sync' };
  }

  const payload: SyncPayload = {
    workspaceId: config.workspaceId,
    chunks: eligible.map(c => ({
      contentHash: c.hash,
      title: c.title,
      body: c.content,
      trustTier: c.trustTier ?? 'institutional',
      sourcePath: c.filePath,
      promotedAt: c.promotedAt,
    })),
    syncedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${config.endpoint}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return {
        synced: 0,
        failed: eligible.length,
        errors: [`Cloud API returned ${res.status}: ${text}`],
      };
    }

    // Cloud API returns { synced: N, failed: N, errors: string[] }
    const result = await res.json() as { synced?: number; failed?: number; errors?: string[] };
    return {
      synced: result.synced ?? eligible.length,
      failed: result.failed ?? 0,
      errors: result.errors ?? [],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      synced: 0,
      failed: eligible.length,
      errors: [msg],
    };
  }
}
