import type { JWTPayload } from 'jose';
import type { RoleMap } from './types.js';

// All ctxhub roles in descending privilege order.
export const VALID_ROLES = ['owner', 'admin', 'member', 'reader', 'machine'] as const;
export type CtxhubRole = typeof VALID_ROLES[number];

export function isValidRole(role: string): role is CtxhubRole {
  return (VALID_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve the ctxhub roles for an authenticated principal.
 *
 * @param idPayload  - Validated Entra ID token payload (from jose jwtVerify)
 * @param sub        - The ctxhub subject identifier (Entra oid or sub)
 * @param roleMap    - Role mapping config from auth.json (optional)
 */
export function resolveRoles(
  idPayload: JWTPayload,
  sub: string,
  roleMap: RoleMap | undefined
): string[] {
  const map = roleMap ?? {};
  const ownerSubs = map.ownerSubs ?? [];
  const groupRoles = map.groupRoles ?? {};
  const defaultRole = map.defaultRole ?? 'member';

  // 1. Explicit owner override by Entra object ID
  if (ownerSubs.includes(sub)) {
    return ['owner'];
  }

  // 2. Group-based mapping (requires groupMembershipClaims in app manifest)
  const groups = Array.isArray(idPayload['groups'])
    ? (idPayload['groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];

  const mapped = new Set<string>();
  for (const group of groups) {
    const role = groupRoles[group];
    if (role) mapped.add(role);
  }

  if (mapped.size > 0) {
    return [...mapped];
  }

  // 3. Default
  return [defaultRole];
}
