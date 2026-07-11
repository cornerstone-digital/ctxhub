import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoleForOrgMember } from './groups.js';
import type { Org } from './types.js';

function makeOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: 'org-1',
    groupId: 'group-1',
    name: 'Test Org',
    tenantId: 'tenant-id',
    trustTier: 'participant',
    addedAt: '2026-01-01T00:00:00Z',
    addedBy: 'admin',
    ...overrides,
  };
}

// ── resolveRoleForOrgMember ───────────────────────────────────────────────────

describe('resolveRoleForOrgMember', () => {
  test('returns role from roleOverrides when sub matches', () => {
    const org = makeOrg({
      identityConfig: {
        roleOverrides: { 'user-sub-123': 'admin' },
      },
    });
    assert.equal(resolveRoleForOrgMember('user-sub-123', [], org), 'admin');
  });

  test('roleOverrides takes precedence over groupRoles', () => {
    const org = makeOrg({
      identityConfig: {
        roleOverrides: { 'user-sub-123': 'owner' },
        groupRoles: { 'entra-group-abc': 'member' },
        defaultRole: 'reader',
      },
    });
    assert.equal(resolveRoleForOrgMember('user-sub-123', ['entra-group-abc'], org), 'owner');
  });

  test('returns role from groupRoles when entra group matches', () => {
    const org = makeOrg({
      identityConfig: {
        groupRoles: { 'entra-group-abc': 'member' },
      },
    });
    assert.equal(resolveRoleForOrgMember('other-sub', ['entra-group-abc'], org), 'member');
  });

  test('returns first matching groupRole when multiple entra groups are present', () => {
    const org = makeOrg({
      identityConfig: {
        groupRoles: {
          'entra-group-abc': 'member',
          'entra-group-xyz': 'admin',
        },
      },
    });
    // First match in the entraGroups array wins
    assert.equal(resolveRoleForOrgMember('other-sub', ['entra-group-abc', 'entra-group-xyz'], org), 'member');
  });

  test('returns defaultRole when no sub or group match', () => {
    const org = makeOrg({
      identityConfig: {
        defaultRole: 'reader',
      },
    });
    assert.equal(resolveRoleForOrgMember('unknown-sub', ['unknown-group'], org), 'reader');
  });

  test('returns defaultRole when groupRoles is empty and no roleOverrides match', () => {
    const org = makeOrg({
      identityConfig: {
        groupRoles: {},
        roleOverrides: {},
        defaultRole: 'member',
      },
    });
    assert.equal(resolveRoleForOrgMember('any-sub', ['any-group'], org), 'member');
  });

  test('returns null when no identityConfig is set', () => {
    const org = makeOrg(); // no identityConfig
    assert.equal(resolveRoleForOrgMember('any-sub', ['any-group'], org), null);
  });

  test('returns null when identityConfig is empty (no overrides, no groupRoles, no defaultRole)', () => {
    const org = makeOrg({ identityConfig: {} });
    assert.equal(resolveRoleForOrgMember('any-sub', ['any-group'], org), null);
  });

  test('returns null when entraGroups is empty and no sub/default match', () => {
    const org = makeOrg({
      identityConfig: {
        groupRoles: { 'entra-group-abc': 'member' },
      },
    });
    assert.equal(resolveRoleForOrgMember('unknown-sub', [], org), null);
  });

  test('groupRoles takes precedence over defaultRole', () => {
    const org = makeOrg({
      identityConfig: {
        groupRoles: { 'entra-group-abc': 'admin' },
        defaultRole: 'reader',
      },
    });
    assert.equal(resolveRoleForOrgMember('other-sub', ['entra-group-abc'], org), 'admin');
  });
});
