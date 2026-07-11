import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performCrossOrgSearch } from './crossOrgSearch.js';
import type { GroupStore } from '../groups/types.js';
import type { Principal } from '../auth/types.js';

function makePrincipal(tenantId?: string): Principal {
  return {
    sub: 'user-001',
    email: 'user@example.com',
    name: 'Test User',
    roles: ['member'],
    tenantId,
  };
}

function makeGroupStore(overrides: Partial<GroupStore> = {}): GroupStore {
  return {
    version: 1,
    groups: [],
    orgs: [],
    sharingPolicies: [],
    ...overrides,
  };
}

function noopFetch(_url: string | URL | Request, _init?: RequestInit): Promise<Response> {
  return Promise.reject(new Error('fetch should not be called'));
}

test('When no group membership, cross-org returns local results and empty peers', async () => {
  const principal = makePrincipal('tenant-abc');
  const groupStore = makeGroupStore(); // no orgs registered
  const localResults = [{ id: 'chunk-1', content: 'local result', score: 0.9 }];

  const result = await performCrossOrgSearch(
    'test query',
    principal,
    groupStore,
    undefined,
    localResults,
    noopFetch as unknown as typeof fetch,
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, 'chunk-1');
  assert.equal(result.sources.local, 1);
  assert.deepEqual(result.sources.peers, {});
});

test('When principal has no tenantId, returns local results only', async () => {
  const principal = makePrincipal(undefined); // no tenantId
  const groupStore = makeGroupStore({
    groups: [{ id: 'group-1', name: 'TestGroup', createdAt: new Date().toISOString(), createdBy: 'admin' }],
    orgs: [{ id: 'org-1', groupId: 'group-1', name: 'Org1', tenantId: 'tenant-1', trustTier: 'participant', addedAt: '', addedBy: '' }],
  });
  const localResults = [{ id: 'chunk-local', score: 0.8 }];

  const result = await performCrossOrgSearch(
    'test query',
    principal,
    groupStore,
    undefined,
    localResults,
    noopFetch as unknown as typeof fetch,
  );

  assert.equal(result.sources.local, 1);
  assert.deepEqual(result.sources.peers, {});
});

test('When peer fetch fails, results still return local results', async () => {
  const principal = makePrincipal('tenant-org-a');
  const groupStore = makeGroupStore({
    groups: [{ id: 'group-1', name: 'TestGroup', createdAt: new Date().toISOString(), createdBy: 'admin' }],
    orgs: [
      { id: 'org-a', groupId: 'group-1', name: 'OrgA', tenantId: 'tenant-org-a', trustTier: 'participant', peerUrl: undefined, addedAt: '', addedBy: '' },
      { id: 'org-b', groupId: 'group-1', name: 'OrgB', tenantId: 'tenant-org-b', trustTier: 'participant', peerUrl: 'https://ctxhub.orgb.example.com', addedAt: '', addedBy: '' },
    ],
    sharingPolicies: [
      { fromOrgId: 'org-a', toOrgId: 'org-b', mode: 'read', updatedAt: new Date().toISOString(), updatedBy: 'admin' },
    ],
  });
  const localResults = [{ id: 'local-chunk', score: 0.9 }];

  const failingFetch = (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return Promise.reject(new Error('Network error'));
  };

  const result = await performCrossOrgSearch(
    'test query',
    principal,
    groupStore,
    'my-token',
    localResults,
    failingFetch as unknown as typeof fetch,
  );

  // Local results should still be returned despite peer failure
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, 'local-chunk');
  assert.equal(result.sources.local, 1);
  // No peer counts since it failed
  assert.deepEqual(result.sources.peers, {});
});

test('Peer results are tagged with source info', async () => {
  const principal = makePrincipal('tenant-org-a');
  const groupStore = makeGroupStore({
    groups: [{ id: 'group-1', name: 'TestGroup', createdAt: new Date().toISOString(), createdBy: 'admin' }],
    orgs: [
      { id: 'org-a', groupId: 'group-1', name: 'OrgA', tenantId: 'tenant-org-a', trustTier: 'participant', addedAt: '', addedBy: '' },
      { id: 'org-b', groupId: 'group-1', name: 'OrgB', tenantId: 'tenant-org-b', trustTier: 'participant', peerUrl: 'https://ctxhub.orgb.example.com', addedAt: '', addedBy: '' },
    ],
    sharingPolicies: [
      { fromOrgId: 'org-a', toOrgId: 'org-b', mode: 'read', updatedAt: new Date().toISOString(), updatedBy: 'admin' },
    ],
  });

  const peerChunk = { id: 'peer-chunk-1', content: 'peer content', score: 0.7 };
  const mockFetch = (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const body = JSON.stringify({ results: [peerChunk] });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };

  const localResults = [{ id: 'local-chunk', score: 0.9 }];

  const result = await performCrossOrgSearch(
    'test query',
    principal,
    groupStore,
    'test-token',
    localResults,
    mockFetch as unknown as typeof fetch,
  );

  assert.equal(result.results.length, 2);

  const peerResult = result.results.find(r => r.id === 'peer-chunk-1');
  assert.ok(peerResult, 'Peer result should be in merged results');
  assert.equal(peerResult.source, 'peer');
  assert.equal(peerResult.orgName, 'OrgB');
  assert.equal(peerResult.orgId, 'org-b');

  assert.equal(result.sources.local, 1);
  assert.equal(result.sources.peers['OrgB'], 1);
});

test('Deduplicated results: peer chunk matching local chunk id is not duplicated', async () => {
  const principal = makePrincipal('tenant-org-a');
  const groupStore = makeGroupStore({
    groups: [{ id: 'group-1', name: 'TestGroup', createdAt: new Date().toISOString(), createdBy: 'admin' }],
    orgs: [
      { id: 'org-a', groupId: 'group-1', name: 'OrgA', tenantId: 'tenant-org-a', trustTier: 'participant', addedAt: '', addedBy: '' },
      { id: 'org-b', groupId: 'group-1', name: 'OrgB', tenantId: 'tenant-org-b', trustTier: 'participant', peerUrl: 'https://peer.example.com', addedAt: '', addedBy: '' },
    ],
    sharingPolicies: [
      { fromOrgId: 'org-a', toOrgId: 'org-b', mode: 'bidirectional', updatedAt: new Date().toISOString(), updatedBy: 'admin' },
    ],
  });

  // Both local and peer return the same chunk id
  const sharedChunk = { id: 'shared-chunk', score: 0.9 };
  const mockFetch = (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const body = JSON.stringify([sharedChunk]);
    return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };

  const localResults = [sharedChunk];
  const result = await performCrossOrgSearch('q', principal, groupStore, undefined, localResults, mockFetch as unknown as typeof fetch);

  // Should only have the chunk once (deduplication by id)
  const sharedResults = result.results.filter(r => r.id === 'shared-chunk');
  assert.equal(sharedResults.length, 1);
});
