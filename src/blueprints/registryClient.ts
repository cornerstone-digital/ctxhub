/**
 * Client for the Cloud blueprint registry (src/cloud/service.ts's /blueprints routes).
 *
 * Reuses the same Cloud config as chunk/run sync (getSyncConfig, ~/.ctxhub/cloud.json) --
 * it's the same Cloud service, one endpoint. Not a separate registry to configure.
 */
import type { BlueprintRecord } from '../cloud/types.js';
import type { SyncConfig } from '../cloud/sync.js';

export interface PublishBlueprintOptions {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  /** M8 topology-aware blueprints: service types this blueprint applies to. */
  serviceTypes?: string[];
  public?: boolean;
  publishedBy?: string;
}

export async function publishBlueprint(
  config: SyncConfig,
  archive: Buffer,
  opts: PublishBlueprintOptions
): Promise<BlueprintRecord> {
  const res = await fetch(`${config.endpoint}/blueprints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ ...opts, archiveBase64: archive.toString('base64') }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cloud registry returned ${res.status}: ${text}`);
  }
  const body = await res.json() as { blueprint: BlueprintRecord };
  return body.blueprint;
}

export async function listRegistryBlueprints(config: SyncConfig, query?: string, workspace?: string): Promise<BlueprintRecord[]> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (workspace) params.set('workspace', workspace);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${config.endpoint}/blueprints${qs}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cloud registry returned ${res.status}: ${text}`);
  }
  const body = await res.json() as { blueprints: BlueprintRecord[] };
  return body.blueprints;
}

export async function downloadRegistryBlueprint(config: SyncConfig, name: string, version: string): Promise<Buffer> {
  const res = await fetch(`${config.endpoint}/blueprints/${encodeURIComponent(name)}/${encodeURIComponent(version)}/download`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cloud registry returned ${res.status}: ${text}`);
  }
  const body = await res.json() as { archiveBase64: string };
  return Buffer.from(body.archiveBase64, 'base64');
}
