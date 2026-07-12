import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findCustomRole, resolvePermissions } from './customRoleStore.js';
import type { CustomRoleStore } from './customRoles.js';

function makeStore(roles: CustomRoleStore['roles'] = []): CustomRoleStore {
  return { version: 1, roles };
}

describe('findCustomRole', () => {
  it('returns undefined for unknown role name', () => {
    const store = makeStore();
    assert.equal(findCustomRole(store, 'nonexistent'), undefined);
  });

  it('returns the role when it exists', () => {
    const store = makeStore([
      {
        name: 'reviewer',
        permissions: ['knowledge:read', 'audit:read'],
        createdAt: new Date().toISOString(),
        createdBy: 'test',
      },
    ]);
    const role = findCustomRole(store, 'reviewer');
    assert.ok(role !== undefined);
    assert.equal(role.name, 'reviewer');
  });
});

describe('resolvePermissions', () => {
  it('resolves built-in owner role to include admin:all', () => {
    const store = makeStore();
    const perms = resolvePermissions('owner', store);
    assert.ok(perms.includes('admin:all'));
  });

  it('resolves built-in member role to knowledge:read and workspace:read but not admin:all', () => {
    const store = makeStore();
    const perms = resolvePermissions('member', store);
    assert.ok(perms.includes('knowledge:read'));
    assert.ok(perms.includes('workspace:read'));
    assert.ok(!perms.includes('admin:all'));
  });

  it('custom role with inheritsFrom member inherits member permissions', () => {
    const store = makeStore([
      {
        name: 'auditor',
        permissions: ['audit:read'],
        inheritsFrom: 'member',
        createdAt: new Date().toISOString(),
        createdBy: 'test',
      },
    ]);
    const perms = resolvePermissions('auditor', store);
    assert.ok(perms.includes('audit:read'));
    assert.ok(perms.includes('knowledge:read'));   // from member
    assert.ok(perms.includes('workspace:read'));   // from member
    assert.ok(!perms.includes('admin:all'));
  });

  it('custom role without inheritsFrom returns only own permissions', () => {
    const store = makeStore([
      {
        name: 'reader-plus',
        permissions: ['knowledge:read', 'knowledge:write'],
        createdAt: new Date().toISOString(),
        createdBy: 'test',
      },
    ]);
    const perms = resolvePermissions('reader-plus', store);
    assert.deepEqual(perms, ['knowledge:read', 'knowledge:write']);
  });

  it('returns empty array for unknown role name', () => {
    const store = makeStore();
    const perms = resolvePermissions('nonexistent', store);
    assert.equal(perms.length, 0);
  });
});

describe('loadCustomRoleStore (shape)', () => {
  it('empty store has correct shape', () => {
    const store = makeStore();
    assert.equal(store.version, 1);
    assert.equal(store.roles.length, 0);
  });
});
