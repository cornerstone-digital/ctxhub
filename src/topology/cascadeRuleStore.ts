import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { CascadeRule, CascadeRuleStore } from './cascadeRules.js';
import type { TopologyStore } from './types.js';
import type { GroupStore } from '../groups/types.js';

export function getCascadeRuleStorePath(): string {
  return path.join(getCtxhubHome(), 'cascade-rules.json');
}

export async function loadCascadeRuleStore(
  storePath = getCascadeRuleStorePath(),
): Promise<CascadeRuleStore> {
  if (!(await pathExists(storePath))) {
    return { version: 1, rules: [] };
  }
  const raw = await readText(storePath);
  const parsed = JSON.parse(raw) as Partial<CascadeRuleStore>;
  return { version: 1, rules: parsed.rules ?? [] };
}

export async function saveCascadeRuleStore(
  store: CascadeRuleStore,
  storePath = getCascadeRuleStorePath(),
): Promise<void> {
  await writeText(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

// ── Pure query helpers ────────────────────────────────────────────────────────

export function findRule(store: CascadeRuleStore, id: string): CascadeRule | undefined {
  return store.rules.find(r => r.id === id || r.id.startsWith(id));
}

export function getRulesForOrg(store: CascadeRuleStore, triggerOrgId: string): CascadeRule[] {
  return store.rules.filter(r => r.triggerOrgId === triggerOrgId);
}

/**
 * For each depends_on edge where fromId and toId belong to different orgs
 * (determined by workspaceId on repositories, or via topology service → repo mapping),
 * create a CascadeRule with basis='topology'.
 *
 * Strategy: look at all depends_on edges. For each, look up the services/repos
 * to see if they are associated with different orgs via the groupStore.
 * Since topology nodes don't directly carry orgIds, we match by workspaceId on repos
 * and then find orgs that own that workspace.
 *
 * Returns array of rules (does not save).
 */
export function deriveRulesFromTopology(
  topologyStore: TopologyStore,
  groupStore: GroupStore,
): CascadeRule[] {
  const derived: CascadeRule[] = [];

  // Build a map from workspaceId → orgId using groupStore
  // Orgs don't directly have workspaceIds; we use org.id as the "org" marker
  // and match repos by workspaceId to see if they're different.
  // For cross-org detection: two repos are in different "orgs" if their workspaceIds
  // differ (or one has workspaceId and another doesn't).
  // A more robust approach: if two edges' ends have different workspaceIds that
  // map to different orgs.

  const dependsOnEdges = topologyStore.edges.filter(e => e.edgeType === 'depends_on');

  for (const edge of dependsOnEdges) {
    // Resolve the "org" for the from and to nodes
    const fromOrgId = resolveOrgForNode(edge.fromId, edge.fromType, topologyStore, groupStore);
    const toOrgId = resolveOrgForNode(edge.toId, edge.toType, topologyStore, groupStore);

    // Only create a rule if both nodes have org associations AND they differ
    if (!fromOrgId || !toOrgId || fromOrgId === toOrgId) continue;

    const rule: CascadeRule = {
      id: crypto.randomUUID(),
      name: `topology:${edge.id.substring(0, 8)}`,
      triggerOrgId: fromOrgId,
      targetOrgId: toOrgId,
      basis: 'topology',
      topologyEdgeId: edge.id,
      createdAt: new Date().toISOString(),
      createdBy: 'system',
      active: true,
    };

    derived.push(rule);
  }

  return derived;
}

/**
 * Resolve orgId for a topology node (service or repository).
 * For a repository: use its workspaceId to find a matching org.
 * For a service: look up its repositoryId, then the repo's workspaceId.
 */
function resolveOrgForNode(
  nodeId: string,
  nodeType: 'service' | 'repository',
  topologyStore: TopologyStore,
  groupStore: GroupStore,
): string | undefined {
  let workspaceId: string | undefined;

  if (nodeType === 'repository') {
    const repo = topologyStore.repositories.find(r => r.id === nodeId);
    workspaceId = repo?.workspaceId;
  } else {
    const service = topologyStore.services.find(s => s.id === nodeId);
    if (service?.repositoryId) {
      const repo = topologyStore.repositories.find(r => r.id === service.repositoryId);
      workspaceId = repo?.workspaceId;
    }
  }

  if (!workspaceId) return undefined;

  // Find org by matching workspaceId to org.id (simple convention: org.id = workspaceId)
  // Also check if any org's tenantId matches. In practice, the workspace-to-org mapping
  // isn't direct in the current data model, so we use the workspaceId as a proxy for orgId.
  const matchingOrg = groupStore.orgs.find(o => o.id === workspaceId);
  return matchingOrg?.id ?? workspaceId;
}
