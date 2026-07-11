import { loadGroupStore, saveGroupStore, findGroup, findOrg, findSharingPolicy, getGroupStorePath } from './store.js';
import type { CorporateGroup, GroupStore, Org, SharingMode, SharingPolicy, TrustTier } from './types.js';
import { eventBus } from '../events/eventBus.js';

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
  try { eventBus.publish({ type: 'group.created', groupId: group.id, name: group.name, createdBy }); } catch {}
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
  try { eventBus.publish({ type: 'group.org_added', groupId, orgId: org.id, orgName: org.name, tenantId: org.tenantId, addedBy }); } catch {}
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
  try { eventBus.publish({ type: 'group.org_removed', groupId, orgId, removedBy }); } catch {}
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
    try { eventBus.publish({ type: 'group.sharing_updated', groupId: fromOrg.groupId, fromOrgId, toOrgId, mode, updatedBy }); } catch {}
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
  try { eventBus.publish({ type: 'group.sharing_updated', groupId: fromOrg.groupId, fromOrgId, toOrgId, mode, updatedBy }); } catch {}
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

// ── canSearchCrossOrg ─────────────────────────────────────────────────────────

/**
 * Returns true if fromOrg has read or bidirectional access to toOrg's knowledge.
 */
export function canSearchCrossOrg(store: GroupStore, fromOrgId: string, toOrgId: string): boolean {
  const policy = findSharingPolicy(store, fromOrgId, toOrgId);
  if (!policy) return false;
  return policy.mode === 'read' || policy.mode === 'bidirectional';
}
