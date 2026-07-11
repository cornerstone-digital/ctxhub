import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { CorporateGroup, GroupStore, Org, SharingMode, SharingPolicy } from './types.js';

// Global, not per-workspace — groups span workspaces.
export function getGroupStorePath(): string {
  return path.join(getCtxhubHome(), 'groups.json');
}

export async function loadGroupStore(storePath = getGroupStorePath()): Promise<GroupStore> {
  if (!(await pathExists(storePath))) {
    return { version: 1, groups: [], orgs: [], sharingPolicies: [] };
  }

  const raw = await readText(storePath);
  const parsed = JSON.parse(raw) as Partial<GroupStore>;
  return {
    version: 1,
    groups: parsed.groups ?? [],
    orgs: parsed.orgs ?? [],
    sharingPolicies: parsed.sharingPolicies ?? [],
  };
}

export async function saveGroupStore(store: GroupStore, storePath = getGroupStorePath()): Promise<void> {
  await writeText(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

// ── Pure query helpers (take the store as a parameter, no I/O) ────────────────

export function findGroup(store: GroupStore, id: string): CorporateGroup | undefined {
  return store.groups.find(g => g.id === id);
}

export function findGroupByName(store: GroupStore, name: string): CorporateGroup | undefined {
  return store.groups.find(g => g.name === name);
}

export function findOrg(store: GroupStore, id: string): Org | undefined {
  return store.orgs.find(o => o.id === id);
}

export function findOrgsByGroup(store: GroupStore, groupId: string): Org[] {
  return store.orgs.filter(o => o.groupId === groupId);
}

export function findSharingPolicy(store: GroupStore, fromOrgId: string, toOrgId: string): SharingPolicy | undefined {
  return store.sharingPolicies.find(p => p.fromOrgId === fromOrgId && p.toOrgId === toOrgId);
}

export function getEffectiveSharing(store: GroupStore, fromOrgId: string, toOrgId: string): SharingMode {
  const policy = findSharingPolicy(store, fromOrgId, toOrgId);
  return policy?.mode ?? 'none';
}
