import { loadGroupStore, saveGroupStore, findGroup, findOrg, findSharingPolicy, getGroupStorePath, findOrgsByGroup } from './store.js';
import type { CorporateGroup, GroupStore, Org, SharingMode, SharingPolicy, TrustTier } from './types.js';
import { eventBus } from '../events/eventBus.js';
import type { KnowledgeObject } from '../knowledge/types.js';

// ── createGroup ───────────────────────────────────────────────────────────────

export async function createGroup(
  name: string,
  createdBy: string,
  storePath = getGroupStorePath(),
): Promise<CorporateGroup> {
  const store = await loadGroupStore(storePath);

  const group: CorporateGroup = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    createdBy,
  };

  store.groups.push(group);
  await saveGroupStore(store, storePath);
  try { eventBus.publish({ type: 'group.created', groupId: group.id, name: group.name, createdBy }); } catch { /* best-effort */ }
  return group;
}

// ── addOrg ────────────────────────────────────────────────────────────────────

export type OrgDefinition = {
  name: string;
  tenantId: string;
  groupFilter?: string;
  trustTier?: TrustTier;
  peerUrl?: string;
};

export async function addOrg(
  groupId: string,
  orgDef: OrgDefinition,
  addedBy: string,
  storePath = getGroupStorePath(),
): Promise<Org> {
  const store = await loadGroupStore(storePath);

  const group = findGroup(store, groupId);
  if (!group) {
    throw new Error(`No corporate group with id "${groupId}"`);
  }

  const org: Org = {
    id: crypto.randomUUID(),
    groupId,
    name: orgDef.name,
    tenantId: orgDef.tenantId,
    groupFilter: orgDef.groupFilter,
    trustTier: orgDef.trustTier ?? 'participant',
    peerUrl: orgDef.peerUrl,
    addedAt: new Date().toISOString(),
    addedBy,
  };

  store.orgs.push(org);
  await saveGroupStore(store, storePath);
  try { eventBus.publish({ type: 'group.org_added', groupId, orgId: org.id, orgName: org.name, tenantId: org.tenantId, addedBy }); } catch { /* best-effort */ }
  return org;
}

// ── removeOrg ─────────────────────────────────────────────────────────────────

export async function removeOrg(
  groupId: string,
  orgId: string,
  removedBy: string,
  storePath = getGroupStorePath(),
): Promise<void> {
  const store = await loadGroupStore(storePath);

  const group = findGroup(store, groupId);
  if (!group) {
    throw new Error(`No corporate group with id "${groupId}"`);
  }

  const orgIndex = store.orgs.findIndex(o => o.id === orgId && o.groupId === groupId);
  if (orgIndex === -1) {
    throw new Error(`No org with id "${orgId}" in group "${groupId}"`);
  }

  store.orgs.splice(orgIndex, 1);

  // Remove all sharing policies that involve this org
  store.sharingPolicies = store.sharingPolicies.filter(
    p => p.fromOrgId !== orgId && p.toOrgId !== orgId
  );

  await saveGroupStore(store, storePath);
  try { eventBus.publish({ type: 'group.org_removed', groupId, orgId, removedBy }); } catch { /* best-effort */ }
}

// ── updateSharing ─────────────────────────────────────────────────────────────

export async function updateSharing(
  fromOrgId: string,
  toOrgId: string,
  mode: SharingMode,
  updatedBy: string,
  storePath = getGroupStorePath(),
): Promise<SharingPolicy> {
  const store = await loadGroupStore(storePath);

  // Validate both orgs exist
  const fromOrg = findOrg(store, fromOrgId);
  if (!fromOrg) throw new Error(`No org with id "${fromOrgId}"`);

  const toOrg = findOrg(store, toOrgId);
  if (!toOrg) throw new Error(`No org with id "${toOrgId}"`);

  const now = new Date().toISOString();

  if (mode === 'none') {
    // Delete both directions
    store.sharingPolicies = store.sharingPolicies.filter(
      p => !(p.fromOrgId === fromOrgId && p.toOrgId === toOrgId) &&
           !(p.fromOrgId === toOrgId && p.toOrgId === fromOrgId)
    );
    await saveGroupStore(store, storePath);
    try { eventBus.publish({ type: 'group.sharing_updated', groupId: fromOrg.groupId, fromOrgId, toOrgId, mode, updatedBy }); } catch { /* best-effort */ }
    // Return a placeholder representing the deleted state
    return { fromOrgId, toOrgId, mode: 'none', updatedAt: now, updatedBy };
  }

  // Upsert the fromOrg → toOrg direction
  const policy: SharingPolicy = { fromOrgId, toOrgId, mode, updatedAt: now, updatedBy };
  upsertPolicy(store, policy);

  if (mode === 'bidirectional') {
    // Upsert the reverse direction too
    upsertPolicy(store, { fromOrgId: toOrgId, toOrgId: fromOrgId, mode: 'bidirectional', updatedAt: now, updatedBy });
  } else {
    // For 'read': remove any existing reverse policy to avoid stale bidirectional state
    store.sharingPolicies = store.sharingPolicies.filter(
      p => !(p.fromOrgId === toOrgId && p.toOrgId === fromOrgId)
    );
  }

  await saveGroupStore(store, storePath);
  try { eventBus.publish({ type: 'group.sharing_updated', groupId: fromOrg.groupId, fromOrgId, toOrgId, mode, updatedBy }); } catch { /* best-effort */ }
  return policy;
}

function upsertPolicy(store: GroupStore, policy: SharingPolicy): void {
  const index = store.sharingPolicies.findIndex(
    p => p.fromOrgId === policy.fromOrgId && p.toOrgId === policy.toOrgId
  );
  if (index === -1) {
    store.sharingPolicies.push(policy);
  } else {
    store.sharingPolicies[index] = policy;
  }
}

// ── resolveOrgForUser ─────────────────────────────────────────────────────────

/**
 * Given a user's Entra tenantId, find which Org (if any) they belong to.
 * Does not check groupFilter — that requires token claims inspection at login time.
 */
export function resolveOrgForUser(tenantId: string, store: GroupStore): Org | undefined {
  return store.orgs.find(o => o.tenantId === tenantId);
}

// ── resolveRoleForOrgMember ───────────────────────────────────────────────────

/**
 * Resolves the ctxhub role for a user within a specific org, using the org's
 * identityConfig. Resolution order:
 *   1. roleOverrides[sub]
 *   2. groupRoles[entraGroupId] (first match)
 *   3. identityConfig.defaultRole
 *   4. null (caller should fall back to global role map)
 */
export function resolveRoleForOrgMember(sub: string, entraGroups: string[], org: Org): string | null {
  if (org.identityConfig?.roleOverrides?.[sub]) {
    return org.identityConfig.roleOverrides[sub];
  }
  if (org.identityConfig?.groupRoles) {
    for (const g of entraGroups) {
      const role = org.identityConfig.groupRoles[g];
      if (role) return role;
    }
  }
  if (org.identityConfig?.defaultRole) {
    return org.identityConfig.defaultRole;
  }
  return null;
}

// ── updateOrgIdentityConfig ───────────────────────────────────────────────────

export async function setOrgIdentityDefaultRole(
  groupId: string,
  orgId: string,
  role: string,
  storePath = getGroupStorePath(),
): Promise<Org> {
  const store = await loadGroupStore(storePath);
  const group = findGroup(store, groupId);
  if (!group) throw new Error(`No corporate group with id "${groupId}"`);
  const org = findOrg(store, orgId);
  if (!org || org.groupId !== groupId) throw new Error(`No org with id "${orgId}" in group "${groupId}"`);

  org.identityConfig = { ...org.identityConfig, defaultRole: role };
  await saveGroupStore(store, storePath);
  return org;
}

export async function addOrgIdentityGroupRole(
  groupId: string,
  orgId: string,
  entraGroup: string,
  role: string,
  storePath = getGroupStorePath(),
): Promise<Org> {
  const store = await loadGroupStore(storePath);
  const group = findGroup(store, groupId);
  if (!group) throw new Error(`No corporate group with id "${groupId}"`);
  const org = findOrg(store, orgId);
  if (!org || org.groupId !== groupId) throw new Error(`No org with id "${orgId}" in group "${groupId}"`);

  org.identityConfig = {
    ...org.identityConfig,
    groupRoles: { ...org.identityConfig?.groupRoles, [entraGroup]: role },
  };
  await saveGroupStore(store, storePath);
  return org;
}

export async function addOrgIdentityOverride(
  groupId: string,
  orgId: string,
  sub: string,
  role: string,
  storePath = getGroupStorePath(),
): Promise<Org> {
  const store = await loadGroupStore(storePath);
  const group = findGroup(store, groupId);
  if (!group) throw new Error(`No corporate group with id "${groupId}"`);
  const org = findOrg(store, orgId);
  if (!org || org.groupId !== groupId) throw new Error(`No org with id "${orgId}" in group "${groupId}"`);

  org.identityConfig = {
    ...org.identityConfig,
    roleOverrides: { ...org.identityConfig?.roleOverrides, [sub]: role },
  };
  await saveGroupStore(store, storePath);
  return org;
}

// ── canSearchCrossOrg ─────────────────────────────────────────────────────────

/**
 * Returns true if fromOrg has read or bidirectional access to toOrg's knowledge.
 */
export function canSearchCrossOrg(store: GroupStore, fromOrgId: string, toOrgId: string): boolean {
  const policy = findSharingPolicy(store, fromOrgId, toOrgId);
  if (!policy) return false;
  return policy.mode === 'read' || policy.mode === 'bidirectional';
}

// ── queryGroupKnowledge ───────────────────────────────────────────────────────

/**
 * Query knowledge from peer orgs within the same corporate group.
 *
 * For each other org with read/bidirectional sharing policy:
 *   - If the org has a peerUrl: GET <peerUrl>/knowledge?q=<query>&state=active (3s timeout)
 *   - Otherwise: skip (peer not reachable)
 *
 * Returns results grouped by org.
 */
export async function queryGroupKnowledge(
  query: string,
  requestingTenantId: string,
  groupStore: GroupStore,
  options?: { minConfidence?: number; tags?: string[] },
): Promise<Array<{ orgName: string; orgId: string; objects: KnowledgeObject[] }>> {
  // Resolve the requesting org from tenantId
  const requestingOrg = resolveOrgForUser(requestingTenantId, groupStore);
  if (!requestingOrg) return [];

  // Find the group
  const group = groupStore.groups.find(g => g.id === requestingOrg.groupId);
  if (!group) return [];

  // Get all orgs in the group except the requesting one
  const peerOrgs = findOrgsByGroup(groupStore, group.id).filter(
    o => o.id !== requestingOrg.id,
  );

  const results: Array<{ orgName: string; orgId: string; objects: KnowledgeObject[] }> = [];

  for (const peerOrg of peerOrgs) {
    // Check sharing policy: requesting org must have read/bidirectional access to peer
    if (!canSearchCrossOrg(groupStore, requestingOrg.id, peerOrg.id)) continue;

    // Peer must have a peerUrl configured
    if (!peerOrg.peerUrl) continue;

    try {
      const params = new URLSearchParams({ q: query, state: 'active' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      let objects: KnowledgeObject[] = [];
      try {
        const res = await fetch(`${peerOrg.peerUrl}/knowledge?${params.toString()}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json() as { objects?: KnowledgeObject[] };
          objects = data.objects ?? [];
        }
      } finally {
        clearTimeout(timeout);
      }

      // Filter by minConfidence if set
      if (options?.minConfidence !== undefined) {
        objects = objects.filter(o => o.confidence >= options.minConfidence!);
      }

      // Filter by tags if set
      if (options?.tags?.length) {
        const requiredTags = options.tags;
        objects = objects.filter(o =>
          requiredTags.every(t => o.tags?.includes(t))
        );
      }

      results.push({ orgName: peerOrg.name, orgId: peerOrg.id, objects });
    } catch {
      // timeout or network error — skip this peer
    }
  }

  return results;
}
