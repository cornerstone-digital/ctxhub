import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoles, isValidRole, VALID_ROLES } from './roles.js';
import type { RoleMap } from './types.js';
import type { JWTPayload } from 'jose';

const OWNER_SUB = 'aad-object-id-owner';
const MEMBER_SUB = 'aad-object-id-member';
const GROUP_ADMIN = 'group-id-admin';
const GROUP_READER = 'group-id-reader';

function payload(groups?: string[]): JWTPayload {
  return groups ? { groups } : {};
}

describe('resolveRoles — ownerSubs', () => {
  it('returns owner when sub is in ownerSubs', () => {
    const map: RoleMap = { ownerSubs: [OWNER_SUB] };
    assert.deepEqual(resolveRoles(payload(), OWNER_SUB, map), ['owner']);
  });

  it('does not return owner when sub is not in ownerSubs', () => {
    const map: RoleMap = { ownerSubs: [OWNER_SUB] };
    const roles = resolveRoles(payload(), MEMBER_SUB, map);
    assert.ok(!roles.includes('owner'));
  });

  it('ownerSubs takes precedence over group mapping', () => {
    const map: RoleMap = {
      ownerSubs: [OWNER_SUB],
      groupRoles: { [GROUP_ADMIN]: 'admin' },
    };
    // Even if they're in the admin group, ownerSubs wins
    assert.deepEqual(resolveRoles(payload([GROUP_ADMIN]), OWNER_SUB, map), ['owner']);
  });
});

describe('resolveRoles — groupRoles', () => {
  it('maps a single group to a role', () => {
    const map: RoleMap = { groupRoles: { [GROUP_ADMIN]: 'admin' } };
    const roles = resolveRoles(payload([GROUP_ADMIN]), MEMBER_SUB, map);
    assert.deepEqual(roles, ['admin']);
  });

  it('collects multiple roles from multiple group memberships', () => {
    const map: RoleMap = {
      groupRoles: {
        [GROUP_ADMIN]: 'admin',
        [GROUP_READER]: 'reader',
      },
    };
    const roles = resolveRoles(payload([GROUP_ADMIN, GROUP_READER]), MEMBER_SUB, map);
    assert.ok(roles.includes('admin'));
    assert.ok(roles.includes('reader'));
    assert.equal(roles.length, 2);
  });

  it('ignores unmapped groups', () => {
    const map: RoleMap = { groupRoles: { [GROUP_ADMIN]: 'admin' } };
    const roles = resolveRoles(payload(['unknown-group', GROUP_ADMIN]), MEMBER_SUB, map);
    assert.deepEqual(roles, ['admin']);
  });
});

describe('resolveRoles — defaultRole', () => {
  it('returns default member when no role map configured', () => {
    assert.deepEqual(resolveRoles(payload(), MEMBER_SUB, undefined), ['member']);
  });

  it('returns default member when roleMap is empty', () => {
    assert.deepEqual(resolveRoles(payload(), MEMBER_SUB, {}), ['member']);
  });

  it('uses custom defaultRole', () => {
    const map: RoleMap = { defaultRole: 'reader' };
    assert.deepEqual(resolveRoles(payload(), MEMBER_SUB, map), ['reader']);
  });

  it('uses defaultRole when user has no matching groups', () => {
    const map: RoleMap = {
      groupRoles: { [GROUP_ADMIN]: 'admin' },
      defaultRole: 'reader',
    };
    assert.deepEqual(resolveRoles(payload(['some-other-group']), MEMBER_SUB, map), ['reader']);
  });

  it('does not fall through to default when group matches', () => {
    const map: RoleMap = {
      groupRoles: { [GROUP_ADMIN]: 'admin' },
      defaultRole: 'reader',
    };
    const roles = resolveRoles(payload([GROUP_ADMIN]), MEMBER_SUB, map);
    assert.ok(!roles.includes('reader'));
    assert.deepEqual(roles, ['admin']);
  });
});

describe('resolveRoles — edge cases', () => {
  it('handles non-array groups claim gracefully', () => {
    const badPayload = { groups: 'not-an-array' } as unknown as JWTPayload;
    const map: RoleMap = { groupRoles: { [GROUP_ADMIN]: 'admin' }, defaultRole: 'reader' };
    assert.deepEqual(resolveRoles(badPayload, MEMBER_SUB, map), ['reader']);
  });

  it('handles missing groups claim gracefully', () => {
    assert.deepEqual(resolveRoles({}, MEMBER_SUB, {}), ['member']);
  });
});

describe('isValidRole', () => {
  it('accepts all valid roles', () => {
    for (const role of VALID_ROLES) {
      assert.ok(isValidRole(role), `expected ${role} to be valid`);
    }
  });

  it('rejects unknown roles', () => {
    assert.ok(!isValidRole('superadmin'));
    assert.ok(!isValidRole(''));
    assert.ok(!isValidRole('Owner'));
  });
});
