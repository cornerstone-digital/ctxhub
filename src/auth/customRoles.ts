/**
 * Custom role types for ctxhub Enterprise.
 *
 * Allows admins to define named roles with custom permission sets that can
 * inherit from built-in roles or other custom roles.
 */

export type Permission =
  | 'knowledge:read' | 'knowledge:write' | 'knowledge:promote'
  | 'workspace:read' | 'workspace:write'
  | 'group:read' | 'group:write'
  | 'audit:read'
  | 'admin:all';

export interface CustomRole {
  name: string;          // must not conflict with built-in roles
  description?: string;
  permissions: Permission[];
  inheritsFrom?: string; // built-in or custom role name to inherit from
  createdAt: string;
  createdBy: string;
}

export interface CustomRoleStore {
  version: 1;
  roles: CustomRole[];
}
