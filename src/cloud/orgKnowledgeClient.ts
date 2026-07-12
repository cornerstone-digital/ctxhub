/**
 * Client for the Cloud Org Graph knowledge routes (src/cloud/service.ts's /knowledge routes).
 *
 * Reuses the same Cloud config as chunk/run/knowledge sync (getSyncConfig, ~/.ctxhub/cloud.json)
 * -- one Cloud endpoint, not a separate service to configure. Mirrors registryClient.ts's shape.
 */
import type { SyncConfig } from './sync.js';
import type { CloudKnowledgeObject, CloudKnowledgeEdge, KnowledgeObjectState } from './types.js';

export interface QueryOrgKnowledgeParams {
  q?: string;
  workspace?: string;
  state?: KnowledgeObjectState;
  concept?: string;
  minConfidence?: number;
}

async function cloudFetch<T>(config: SyncConfig, path: string): Promise<T> {
  const res = await fetch(`${config.endpoint}${path}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cloud API returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function queryOrgKnowledge(
  config: SyncConfig,
  params: QueryOrgKnowledgeParams = {},
): Promise<{ objects: CloudKnowledgeObject[]; count: number }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.workspace) qs.set('workspace', params.workspace);
  if (params.state) qs.set('state', params.state);
  if (params.concept) qs.set('concept', params.concept);
  if (params.minConfidence !== undefined) qs.set('minConfidence', String(params.minConfidence));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return cloudFetch(config, `/knowledge${suffix}`);
}

export async function getOrgKnowledgeObject(
  config: SyncConfig,
  id: string,
): Promise<{ object: CloudKnowledgeObject; edges: CloudKnowledgeEdge[] }> {
  return cloudFetch(config, `/knowledge/${encodeURIComponent(id)}`);
}
