import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { ScimStore, ScimUser, ScimGroup } from './types.js';

export function getScimStorePath(): string {
  return path.join(getCtxhubHome(), 'scim.json');
}

export async function loadScimStore(storePath = getScimStorePath()): Promise<ScimStore> {
  if (!(await pathExists(storePath))) {
    return { version: 1, users: [], groups: [] };
  }
  try {
    const raw = await readText(storePath);
    const parsed = JSON.parse(raw) as Partial<ScimStore>;
    return {
      version: 1,
      users: parsed.users ?? [],
      groups: parsed.groups ?? [],
    };
  } catch {
    return { version: 1, users: [], groups: [] };
  }
}

export async function saveScimStore(store: ScimStore, storePath = getScimStorePath()): Promise<void> {
  await writeText(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

// ── Pure query helpers ────────────────────────────────────────────────────────

export function findScimUser(store: ScimStore, id: string): ScimUser | undefined {
  return store.users.find(u => u.id === id);
}

export function findScimUserByUserName(store: ScimStore, userName: string): ScimUser | undefined {
  return store.users.find(u => u.userName === userName);
}

export function findScimGroup(store: ScimStore, id: string): ScimGroup | undefined {
  return store.groups.find(g => g.id === id);
}

export function findScimGroupByDisplayName(store: ScimStore, name: string): ScimGroup | undefined {
  return store.groups.find(g => g.displayName === name);
}
