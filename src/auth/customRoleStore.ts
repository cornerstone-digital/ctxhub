import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { CustomRole, CustomRoleStore, Permission } from './customRoles.js';

export function getCustomRoleStorePath(): string {
  return path.join(getCtxhubHome(), 'custom-roles.json');
}

export async function loadCustomRoleStore(): Promise<CustomRoleStore> {
  const storePath = getCustomRoleStorePath();
  if (!(await pathExists(storePath))) {
    return { version: 1, roles: [] };
  }
  try {
    const raw = await readText(storePath);
    return JSON.parse(raw) as CustomRoleStore;
  } catch {
    return { version: 1, roles: [] };
  }
}

export async function saveCustomRoleStore(store: CustomRoleStore): Promise<void> {
  await writeText(getCustomRoleStorePath(), `${JSON.stringify(store, null, 2)}\n`);
}

export function findCustomRole(store: CustomRoleStore, name: string): CustomRole | undefined {
  return store.roles.find(r => r.name === name);
}

/**
 * The natural permissions for each built-in role (used for inheritance resolution).
 * Built-in roles are ordered by privilege:
 *   owner > admin > member > reader > machine
 */
const BUILTIN_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: ['admin:all', 'knowledge:read', 'knowledge:write', 'knowledge:promote', 'workspace:read', 'workspace:write', 'group:read', 'group:write', 'audit:read'],
  admin: ['knowledge:read', 'knowledge:write', 'knowledge:promote', 'workspace:read', 'workspace:write', 'group:read', 'group:write', 'audit:read'],
  member: ['knowledge:read', 'knowledge:write', 'workspace:read', 'group:read'],
  reader: ['knowledge:read', 'workspace:read', 'group:read'],
  machine: ['knowledge:read', 'workspace:read'],
};

/**
 * Resolve all permissions for a role name, including inherited permissions.
 * Built-in roles are resolved directly. Custom roles may inherit from built-in
 * or other custom roles (one level of inheritance — no transitive resolution).
 */
export function resolvePermissions(roleName: string, store: CustomRoleStore): Permission[] {
  // Check built-in roles first
  const builtin = BUILTIN_ROLE_PERMISSIONS[roleName];
  if (builtin) {
    return [...builtin];
  }

  // Check custom roles
  const customRole = findCustomRole(store, roleName);
  if (!customRole) {
    return [];
  }

  const ownPermissions: Permission[] = [...customRole.permissions];

  if (!customRole.inheritsFrom) {
    return ownPermissions;
  }

  // Resolve inherited permissions
  const inheritedFrom = customRole.inheritsFrom;
  let inheritedPermissions: Permission[];

  const parentBuiltin = BUILTIN_ROLE_PERMISSIONS[inheritedFrom];
  if (parentBuiltin) {
    inheritedPermissions = [...parentBuiltin];
  } else {
    const parentCustom = findCustomRole(store, inheritedFrom);
    inheritedPermissions = parentCustom ? [...parentCustom.permissions] : [];
  }

  // Merge: union of own + inherited, preserving order (own first, then inherited)
  const merged = [...ownPermissions];
  for (const p of inheritedPermissions) {
    if (!merged.includes(p)) merged.push(p);
  }
  return merged;
}
