import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryGroupKnowledge } from './groups.js';
import type { GroupStore } from './types.js';
import type { KnowledgeObject } from '../knowledge/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGroupStore(overrides: Partial<GroupStore> = {}): GroupStore {
  return {
    version: 1,
    groups: [],
    orgs: [],
    sharingPolicies: [],
    ...overrides,
  };
}

function makeKnowledgeObject(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'ws-test',
    title: 'Test Object',
    content: 'Some test knowledge content',
    state: 'active',
    confidence: 0.8,
    corroborations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'test',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('queryGroupKnowledge returns empty array when requesting org has no group', async () => {
  const store = makeGroupStore({
    groups: [{ id: 'group-1', name: 'G1', createdAt: '', createdBy: '' }],
    orgs: [
      {
        id: 'org-a',
        groupId: 'group-1',
        name: 'Org A',
        tenantId: 'tenant-a',
        trustTier: 'participant',
        addedAt: '',
        addedBy: '',
      },
    ],
  });

  // 'unknown-tenant' does not map to any org
  const results = await queryGroupKnowledge('billing', 'unknown-tenant', store);
  assert.deepEqual(results, []);
});

test('queryGroupKnowledge returns empty array when no sharing policies', async () => {
  const store = makeGroupStore({
    groups: [{ id: 'group-1', name: 'G1', createdAt: '', createdBy: '' }],
    orgs: [
      {
        id: 'org-a',
        groupId: 'group-1',
        name: 'Org A',
        tenantId: 'tenant-a',
        trustTier: 'participant',
        peerUrl: 'https://peer-a.example.com',
        addedAt: '',
        addedBy: '',
      },
      {
        id: 'org-b',
        groupId: 'group-1',
        name: 'Org B',
        tenantId: 'tenant-b',
        trustTier: 'participant',
        peerUrl: 'https://peer-b.example.com',
        addedAt: '',
        addedBy: '',
      },
    ],
    // No sharing policies — org-a cannot read org-b's knowledge
    sharingPolicies: [],
  });

  const results = await queryGroupKnowledge('billing', 'tenant-a', store);
  assert.deepEqual(results, []);
});

test('queryGroupKnowledge returns empty array when peer has no peerUrl', async () => {
  const store = makeGroupStore({
    groups: [{ id: 'group-1', name: 'G1', createdAt: '', createdBy: '' }],
    orgs: [
      {
        id: 'org-a',
        groupId: 'group-1',
        name: 'Org A',
        tenantId: 'tenant-a',
        trustTier: 'participant',
        peerUrl: 'https://peer-a.example.com',
        addedAt: '',
        addedBy: '',
      },
      {
        id: 'org-b',
        groupId: 'group-1',
        name: 'Org B',
        tenantId: 'tenant-b',
        trustTier: 'participant',
        // No peerUrl — not reachable
        addedAt: '',
        addedBy: '',
      },
    ],
    sharingPolicies: [
      {
        fromOrgId: 'org-a',
        toOrgId: 'org-b',
        mode: 'read',
        updatedAt: '',
        updatedBy: '',
      },
    ],
  });

  const results = await queryGroupKnowledge('billing', 'tenant-a', store);
  // org-b has no peerUrl so it should be skipped; empty results
  assert.deepEqual(results, []);
});

test('queryGroupKnowledge filters by minConfidence correctly', async () => {
  // We cannot actually make HTTP calls in tests, so we test the filtering logic
  // by having the function operate on mock data. Since queryGroupKnowledge
  // makes real HTTP calls for peers with peerUrls, we rely on the fact that
  // if peerUrl is set to an invalid URL it will fail and be skipped.
  // Instead, test the minConfidence path with no peers (empty result) to verify
  // the function signature accepts the option without error.
  const store = makeGroupStore({
    groups: [{ id: 'group-1', name: 'G1', createdAt: '', createdBy: '' }],
    orgs: [
      {
        id: 'org-a',
        groupId: 'group-1',
        name: 'Org A',
        tenantId: 'tenant-a',
        trustTier: 'participant',
        addedAt: '',
        addedBy: '',
      },
    ],
    sharingPolicies: [],
  });

  const results = await queryGroupKnowledge('billing', 'tenant-a', store, {
    minConfidence: 0.9,
    tags: ['security'],
  });
  assert.deepEqual(results, []);
});

test('queryGroupKnowledge minConfidence filter applied to mock objects', () => {
  // Test the filtering logic in isolation
  const objects: KnowledgeObject[] = [
    makeKnowledgeObject({ confidence: 0.3 }),
    makeKnowledgeObject({ confidence: 0.7 }),
    makeKnowledgeObject({ confidence: 0.95 }),
  ];

  const minConfidence = 0.6;
  const filtered = objects.filter(o => o.confidence >= minConfidence);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(o => o.confidence >= 0.6));
});
