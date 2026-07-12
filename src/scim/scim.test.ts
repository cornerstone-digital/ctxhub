import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  loadScimStore,
  saveScimStore,
  findScimUser,
  findScimUserByUserName,
  findScimGroup,
} from './store.js';
import type { ScimStore, ScimUser } from './types.js';

// Use a temp directory per test so each test starts fresh
let tmpDir: string;

describe('loadScimStore', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxhub-scim-test-'));
  });

  it('returns empty store when no file exists', async () => {
    const store = await loadScimStore(path.join(tmpDir, 'scim.json'));
    assert.deepEqual(store, { version: 1, users: [], groups: [] });
  });

  it('returns persisted store when file exists', async () => {
    const storePath = path.join(tmpDir, 'scim.json');
    const data: ScimStore = {
      version: 1,
      users: [
        {
          id: 'u1',
          userName: 'alice@example.com',
          active: true,
          meta: { resourceType: 'User', created: '2024-01-01T00:00:00Z', lastModified: '2024-01-01T00:00:00Z', location: '/scim/v2/Users/u1' },
        },
      ],
      groups: [],
    };
    await fs.writeFile(storePath, JSON.stringify(data));
    const loaded = await loadScimStore(storePath);
    assert.equal(loaded.users.length, 1);
    assert.equal(loaded.users[0].userName, 'alice@example.com');
  });
});

describe('findScimUser', () => {
  it('returns undefined for unknown id', () => {
    const store: ScimStore = { version: 1, users: [], groups: [] };
    assert.equal(findScimUser(store, 'nope'), undefined);
  });

  it('returns the user for a known id', () => {
    const store: ScimStore = {
      version: 1,
      users: [
        {
          id: 'abc123',
          userName: 'bob@example.com',
          active: true,
          meta: { resourceType: 'User', created: '2024-01-01T00:00:00Z', lastModified: '2024-01-01T00:00:00Z', location: '/scim/v2/Users/abc123' },
        },
      ],
      groups: [],
    };
    const found = findScimUser(store, 'abc123');
    assert.equal(found?.userName, 'bob@example.com');
  });
});

describe('findScimUserByUserName', () => {
  it('finds a user by email (userName)', () => {
    const store: ScimStore = {
      version: 1,
      users: [
        {
          id: 'u2',
          userName: 'carol@corp.com',
          active: true,
          meta: { resourceType: 'User', created: '2024-01-01T00:00:00Z', lastModified: '2024-01-01T00:00:00Z', location: '/scim/v2/Users/u2' },
        },
      ],
      groups: [],
    };
    const found = findScimUserByUserName(store, 'carol@corp.com');
    assert.equal(found?.id, 'u2');
  });

  it('returns undefined when not found', () => {
    const store: ScimStore = { version: 1, users: [], groups: [] };
    assert.equal(findScimUserByUserName(store, 'nobody@example.com'), undefined);
  });
});

describe('findScimGroup', () => {
  it('returns undefined for unknown group id', () => {
    const store: ScimStore = { version: 1, users: [], groups: [] };
    assert.equal(findScimGroup(store, 'g999'), undefined);
  });
});

describe('SCIM user deprovisioning via PATCH', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxhub-scim-test-'));
  });

  it('marks user inactive when active is set to false', async () => {
    const storePath = path.join(tmpDir, 'scim.json');
    const user: ScimUser = {
      id: 'u3',
      userName: 'dave@example.com',
      active: true,
      meta: { resourceType: 'User', created: '2024-01-01T00:00:00Z', lastModified: '2024-01-01T00:00:00Z', location: '/scim/v2/Users/u3' },
    };
    const store: ScimStore = { version: 1, users: [user], groups: [] };

    // Simulate what the PATCH handler does: apply active=false
    const idx = store.users.findIndex(u => u.id === 'u3');
    store.users[idx] = { ...store.users[idx], active: false };
    await saveScimStore(store, storePath);

    const reloaded = await loadScimStore(storePath);
    assert.equal(reloaded.users[0].active, false);
  });
});

describe('SCIM user soft delete via DELETE', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxhub-scim-test-'));
  });

  it('sets active to false rather than removing the user', async () => {
    const storePath = path.join(tmpDir, 'scim.json');
    const user: ScimUser = {
      id: 'u4',
      userName: 'eve@example.com',
      active: true,
      meta: { resourceType: 'User', created: '2024-01-01T00:00:00Z', lastModified: '2024-01-01T00:00:00Z', location: '/scim/v2/Users/u4' },
    };
    const store: ScimStore = { version: 1, users: [user], groups: [] };

    // Simulate what the DELETE handler does: soft delete
    const idx = store.users.findIndex(u => u.id === 'u4');
    store.users[idx] = { ...store.users[idx], active: false };
    await saveScimStore(store, storePath);

    const reloaded = await loadScimStore(storePath);
    // User still exists in store (not hard deleted)
    assert.equal(reloaded.users.length, 1);
    assert.equal(reloaded.users[0].active, false);
  });
});
