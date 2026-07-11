import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { addOrg, canSearchCrossOrg, createGroup, removeOrg, resolveOrgForUser, updateSharing } from './groups.js';
import { loadGroupStore } from './store.js';
import type { GroupStore } from './types.js';

async function withTempStore(run: (storePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-groups-'));
  try {
    await run(path.join(dir, 'groups.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── createGroup ───────────────────────────────────────────────────────────────

describe('createGroup', () => {
  test('creates a group with correct fields', () => withTempStore(async storePath => {
    const group = await createGroup('VodafoneThree UK', 'admin-sub', storePath);

    assert.equal(group.name, 'VodafoneThree UK');
    assert.equal(group.createdBy, 'admin-sub');
    assert.ok(group.id, 'id should be set');
    assert.ok(group.createdAt, 'createdAt should be set');
    // id should look like a UUID
    assert.match(group.id, /^[0-9a-f-]{36}$/);

    const store = await loadGroupStore(storePath);
    assert.equal(store.groups.length, 1);
    assert.deepEqual(store.groups[0], group);
  }));

  test('creates multiple groups independently', () => withTempStore(async storePath => {
    await createGroup('Group A', 'user1', storePath);
    await createGroup('Group B', 'user2', storePath);

    const store = await loadGroupStore(storePath);
    assert.equal(store.groups.length, 2);
    assert.notEqual(store.groups[0].id, store.groups[1].id);
  }));
});

// ── addOrg ────────────────────────────────────────────────────────────────────

describe('addOrg', () => {
  test('adds an org to an existing group', () => withTempStore(async storePath => {
    const group = await createGroup('VodafoneThree UK', 'admin', storePath);

    const org = await addOrg(
      group.id,
      { name: 'Vodafone UK Engineering', tenantId: 'vf-tenant-id', trustTier: 'participant' },
      'admin',
      storePath,
    );

    assert.equal(org.groupId, group.id);
    assert.equal(org.name, 'Vodafone UK Engineering');
    assert.equal(org.tenantId, 'vf-tenant-id');
    assert.equal(org.trustTier, 'participant');
    assert.equal(org.addedBy, 'admin');
    assert.ok(org.id, 'id should be set');

    const store = await loadGroupStore(storePath);
    assert.equal(store.orgs.length, 1);
  }));

  test('defaults trustTier to participant when not specified', () => withTempStore(async storePath => {
    const group = await createGroup('My Group', 'admin', storePath);
    const org = await addOrg(group.id, { name: 'Org A', tenantId: 'tenant-a' }, 'admin', storePath);
    assert.equal(org.trustTier, 'participant');
  }));

  test('rejects addOrg when group does not exist', () => withTempStore(async storePath => {
    await assert.rejects(
      () => addOrg('nonexistent-group-id', { name: 'Org A', tenantId: 't1' }, 'admin', storePath),
      /No corporate group/,
    );
  }));

  test('stores optional groupFilter when provided', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const org = await addOrg(
      group.id,
      { name: 'Org A', tenantId: 't1', groupFilter: 'entra-group-oid', trustTier: 'trusted' },
      'admin',
      storePath,
    );
    assert.equal(org.groupFilter, 'entra-group-oid');
    assert.equal(org.trustTier, 'trusted');
  }));
});

// ── removeOrg ─────────────────────────────────────────────────────────────────

describe('removeOrg', () => {
  test('removes org and all its sharing policies', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    await updateSharing(orgA.id, orgB.id, 'read', 'admin', storePath);

    await removeOrg(group.id, orgA.id, 'admin', storePath);

    const store = await loadGroupStore(storePath);
    assert.equal(store.orgs.length, 1);
    assert.equal(store.orgs[0].id, orgB.id);
    // Sharing policy should be gone
    assert.equal(store.sharingPolicies.length, 0);
  }));

  test('throws when group does not exist', () => withTempStore(async storePath => {
    await assert.rejects(
      () => removeOrg('bad-group', 'bad-org', 'admin', storePath),
      /No corporate group/,
    );
  }));

  test('throws when org is not in the group', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    await assert.rejects(
      () => removeOrg(group.id, 'bad-org-id', 'admin', storePath),
      /No org with id/,
    );
  }));
});

// ── updateSharing ─────────────────────────────────────────────────────────────

describe('updateSharing', () => {
  test('creates a read policy from A to B', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    const policy = await updateSharing(orgA.id, orgB.id, 'read', 'admin', storePath);
    assert.equal(policy.fromOrgId, orgA.id);
    assert.equal(policy.toOrgId, orgB.id);
    assert.equal(policy.mode, 'read');

    const store = await loadGroupStore(storePath);
    assert.equal(store.sharingPolicies.length, 1);
  }));

  test('bidirectional creates policies in both directions', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    await updateSharing(orgA.id, orgB.id, 'bidirectional', 'admin', storePath);

    const store = await loadGroupStore(storePath);
    assert.equal(store.sharingPolicies.length, 2);

    const aToB = store.sharingPolicies.find(p => p.fromOrgId === orgA.id && p.toOrgId === orgB.id);
    const bToA = store.sharingPolicies.find(p => p.fromOrgId === orgB.id && p.toOrgId === orgA.id);
    assert.ok(aToB, 'A→B policy should exist');
    assert.ok(bToA, 'B→A policy should exist');
    assert.equal(aToB?.mode, 'bidirectional');
    assert.equal(bToA?.mode, 'bidirectional');
  }));

  test('setting mode to none removes the policy', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    await updateSharing(orgA.id, orgB.id, 'bidirectional', 'admin', storePath);
    await updateSharing(orgA.id, orgB.id, 'none', 'admin', storePath);

    const store = await loadGroupStore(storePath);
    assert.equal(store.sharingPolicies.length, 0);
  }));

  test('updating an existing policy replaces it', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    await updateSharing(orgA.id, orgB.id, 'read', 'admin', storePath);
    await updateSharing(orgA.id, orgB.id, 'bidirectional', 'admin', storePath);

    const store = await loadGroupStore(storePath);
    // bidirectional creates 2 (A→B and B→A); original read A→B replaced
    const aToB = store.sharingPolicies.find(p => p.fromOrgId === orgA.id && p.toOrgId === orgB.id);
    assert.equal(aToB?.mode, 'bidirectional');
  }));

  test('throws when fromOrg does not exist', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);
    await assert.rejects(
      () => updateSharing('nonexistent', orgB.id, 'read', 'admin', storePath),
      /No org with id/,
    );
  }));
});

// ── resolveOrgForUser ─────────────────────────────────────────────────────────

describe('resolveOrgForUser', () => {
  test('matches by tenantId', () => {
    const store: GroupStore = {
      version: 1,
      groups: [{ id: 'g1', name: 'G', createdAt: '2026-01-01T00:00:00Z', createdBy: 'admin' }],
      orgs: [
        { id: 'o1', groupId: 'g1', name: 'Org A', tenantId: 'tenant-a', trustTier: 'participant', addedAt: '', addedBy: '' },
        { id: 'o2', groupId: 'g1', name: 'Org B', tenantId: 'tenant-b', trustTier: 'participant', addedAt: '', addedBy: '' },
      ],
      sharingPolicies: [],
    };

    const org = resolveOrgForUser('tenant-a', store);
    assert.equal(org?.id, 'o1');
    assert.equal(org?.name, 'Org A');
  });

  test('returns undefined when no org matches', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [
        { id: 'o1', groupId: 'g1', name: 'Org A', tenantId: 'tenant-a', trustTier: 'participant', addedAt: '', addedBy: '' },
      ],
      sharingPolicies: [],
    };

    assert.equal(resolveOrgForUser('unknown-tenant', store), undefined);
  });
});

// ── resolveOrgForUser — additional coverage ───────────────────────────────────

describe('resolveOrgForUser — edge cases', () => {
  test('returns undefined for an empty org list', () => {
    const store: GroupStore = { version: 1, groups: [], orgs: [], sharingPolicies: [] };
    assert.equal(resolveOrgForUser('any-tenant', store), undefined);
  });

  test('returns the correct org when multiple orgs exist with different tenantIds', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [
        { id: 'o1', groupId: 'g1', name: 'Org A', tenantId: 'tenant-a', trustTier: 'participant', addedAt: '', addedBy: '' },
        { id: 'o2', groupId: 'g1', name: 'Org B', tenantId: 'tenant-b', trustTier: 'participant', addedAt: '', addedBy: '' },
        { id: 'o3', groupId: 'g1', name: 'Org C', tenantId: 'tenant-c', trustTier: 'participant', addedAt: '', addedBy: '' },
      ],
      sharingPolicies: [],
    };
    assert.equal(resolveOrgForUser('tenant-b', store)?.id, 'o2');
    assert.equal(resolveOrgForUser('tenant-c', store)?.id, 'o3');
  });
});

// ── canSearchCrossOrg ─────────────────────────────────────────────────────────

describe('canSearchCrossOrg', () => {
  test('returns false when no policy exists', () => {
    const store: GroupStore = { version: 1, groups: [], orgs: [], sharingPolicies: [] };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o2'), false);
  });

  test('returns true for read mode', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [],
      sharingPolicies: [
        { fromOrgId: 'o1', toOrgId: 'o2', mode: 'read', updatedAt: '', updatedBy: '' },
      ],
    };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o2'), true);
  });

  test('returns true for bidirectional mode', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [],
      sharingPolicies: [
        { fromOrgId: 'o1', toOrgId: 'o2', mode: 'bidirectional', updatedAt: '', updatedBy: '' },
      ],
    };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o2'), true);
  });

  test('returns false when policy mode is none', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [],
      sharingPolicies: [
        { fromOrgId: 'o1', toOrgId: 'o2', mode: 'none', updatedAt: '', updatedBy: '' },
      ],
    };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o2'), false);
  });

  test('read mode is unidirectional — reverse direction returns false', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [],
      sharingPolicies: [
        { fromOrgId: 'o1', toOrgId: 'o2', mode: 'read', updatedAt: '', updatedBy: '' },
      ],
    };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o2'), true);
    assert.equal(canSearchCrossOrg(store, 'o2', 'o1'), false);
  });

  test('self-to-self returns false when no self-referencing policy exists', () => {
    const store: GroupStore = { version: 1, groups: [], orgs: [], sharingPolicies: [] };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o1'), false);
  });

  test('bidirectional policies allow access in both directions', () => {
    const store: GroupStore = {
      version: 1,
      groups: [],
      orgs: [],
      sharingPolicies: [
        { fromOrgId: 'o1', toOrgId: 'o2', mode: 'bidirectional', updatedAt: '', updatedBy: '' },
        { fromOrgId: 'o2', toOrgId: 'o1', mode: 'bidirectional', updatedAt: '', updatedBy: '' },
      ],
    };
    assert.equal(canSearchCrossOrg(store, 'o1', 'o2'), true);
    assert.equal(canSearchCrossOrg(store, 'o2', 'o1'), true);
  });
});

// ── updateSharing — additional coverage ───────────────────────────────────────

describe('updateSharing — additional edge cases', () => {
  test('none on non-existent policy is a graceful no-op — returns a none placeholder', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    const policy = await updateSharing(orgA.id, orgB.id, 'none', 'admin', storePath);
    assert.equal(policy.mode, 'none');

    const store = await loadGroupStore(storePath);
    assert.equal(store.sharingPolicies.length, 0);
  }));

  test('read mode removes any existing reverse-direction policy', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    // Manually put a reverse policy in place first via bidirectional, then downgrade A→B to read
    await updateSharing(orgA.id, orgB.id, 'bidirectional', 'admin', storePath);
    await updateSharing(orgA.id, orgB.id, 'read', 'admin', storePath);

    const store = await loadGroupStore(storePath);
    // read should have removed the B→A direction
    const bToA = store.sharingPolicies.find(p => p.fromOrgId === orgB.id && p.toOrgId === orgA.id);
    assert.equal(bToA, undefined, 'B→A policy should be removed when A→B is downgraded to read');
    assert.equal(store.sharingPolicies.length, 1);
    assert.equal(store.sharingPolicies[0].mode, 'read');
  }));

  test('updateSharing with bidirectional then none removes policies in both directions via canSearchCrossOrg', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    const orgB = await addOrg(group.id, { name: 'B', tenantId: 't-b' }, 'admin', storePath);

    await updateSharing(orgA.id, orgB.id, 'bidirectional', 'admin', storePath);
    await updateSharing(orgA.id, orgB.id, 'none', 'admin', storePath);

    const store = await loadGroupStore(storePath);
    // canSearchCrossOrg must return false in both directions after none
    assert.equal(canSearchCrossOrg(store, orgA.id, orgB.id), false);
    assert.equal(canSearchCrossOrg(store, orgB.id, orgA.id), false);
  }));

  test('updateSharing throws when toOrg does not exist', () => withTempStore(async storePath => {
    const group = await createGroup('G', 'admin', storePath);
    const orgA = await addOrg(group.id, { name: 'A', tenantId: 't-a' }, 'admin', storePath);
    await assert.rejects(
      () => updateSharing(orgA.id, 'nonexistent-to-org', 'read', 'admin', storePath),
      /No org with id/,
    );
  }));
});
