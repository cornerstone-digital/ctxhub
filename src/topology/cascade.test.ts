import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  loadCascadeRuleStore,
  saveCascadeRuleStore,
  getRulesForOrg,
  deriveRulesFromTopology,
} from './cascadeRuleStore.js';
import type { CascadeRuleStore } from './cascadeRules.js';
import type { TopologyStore } from './types.js';
import type { GroupStore } from '../groups/types.js';

async function withTempPath(run: (storePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-cascade-'));
  try {
    await run(path.join(dir, 'cascade-rules.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadCascadeRuleStore returns empty store when no file exists', () => {
  return withTempPath(async storePath => {
    const store = await loadCascadeRuleStore(storePath);
    assert.deepEqual(store, { version: 1, rules: [] });
  });
});

test('getRulesForOrg returns only rules matching triggerOrgId', () => {
  return withTempPath(async storePath => {
    const store: CascadeRuleStore = {
      version: 1,
      rules: [
        {
          id: 'rule-1',
          name: 'rule-one',
          triggerOrgId: 'org-a',
          targetOrgId: 'org-b',
          basis: 'manual',
          createdAt: new Date().toISOString(),
          createdBy: 'test',
          active: true,
        },
        {
          id: 'rule-2',
          name: 'rule-two',
          triggerOrgId: 'org-b',
          targetOrgId: 'org-a',
          basis: 'manual',
          createdAt: new Date().toISOString(),
          createdBy: 'test',
          active: true,
        },
        {
          id: 'rule-3',
          name: 'rule-three',
          triggerOrgId: 'org-a',
          targetOrgId: 'org-c',
          basis: 'topology',
          createdAt: new Date().toISOString(),
          createdBy: 'system',
          active: true,
        },
      ],
    };

    await saveCascadeRuleStore(store, storePath);
    const loaded = await loadCascadeRuleStore(storePath);

    const rulesForOrgA = getRulesForOrg(loaded, 'org-a');
    assert.equal(rulesForOrgA.length, 2);
    assert.ok(rulesForOrgA.every(r => r.triggerOrgId === 'org-a'));

    const rulesForOrgB = getRulesForOrg(loaded, 'org-b');
    assert.equal(rulesForOrgB.length, 1);
    assert.equal(rulesForOrgB[0].id, 'rule-2');

    const rulesForOrgZ = getRulesForOrg(loaded, 'org-z');
    assert.equal(rulesForOrgZ.length, 0);
  });
});

test('deriveRulesFromTopology creates rules for cross-org depends_on edges', () => {
  // Two repos in different "orgs" (workspaceId used as orgId proxy)
  // Service A (in repo-1 = workspace org-a) depends_on Service B (in repo-2 = workspace org-b)
  const topologyStore: TopologyStore = {
    version: 1,
    repositories: [
      {
        id: 'repo-1',
        name: 'Repo 1',
        workspaceId: 'org-a',
        addedAt: '',
        addedBy: '',
      },
      {
        id: 'repo-2',
        name: 'Repo 2',
        workspaceId: 'org-b',
        addedAt: '',
        addedBy: '',
      },
    ],
    services: [
      { id: 'svc-a', name: 'Service A', repositoryId: 'repo-1', addedAt: '', addedBy: '' },
      { id: 'svc-b', name: 'Service B', repositoryId: 'repo-2', addedAt: '', addedBy: '' },
    ],
    edges: [
      {
        id: 'edge-1',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-b',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
    ],
  };

  const groupStore: GroupStore = {
    version: 1,
    groups: [{ id: 'group-1', name: 'Test Group', createdAt: '', createdBy: '' }],
    orgs: [
      { id: 'org-a', groupId: 'group-1', name: 'Org A', tenantId: 'tenant-a', trustTier: 'participant', addedAt: '', addedBy: '' },
      { id: 'org-b', groupId: 'group-1', name: 'Org B', tenantId: 'tenant-b', trustTier: 'participant', addedAt: '', addedBy: '' },
    ],
    sharingPolicies: [],
  };

  const rules = deriveRulesFromTopology(topologyStore, groupStore);

  assert.equal(rules.length, 1);
  assert.equal(rules[0].triggerOrgId, 'org-a');
  assert.equal(rules[0].targetOrgId, 'org-b');
  assert.equal(rules[0].basis, 'topology');
  assert.equal(rules[0].topologyEdgeId, 'edge-1');
  assert.equal(rules[0].active, true);
});

test('deriveRulesFromTopology does not create rules for same-org edges', () => {
  // Both services in the same org
  const topologyStore: TopologyStore = {
    version: 1,
    repositories: [
      {
        id: 'repo-1',
        name: 'Repo 1',
        workspaceId: 'org-a',
        addedAt: '',
        addedBy: '',
      },
    ],
    services: [
      { id: 'svc-a', name: 'Service A', repositoryId: 'repo-1', addedAt: '', addedBy: '' },
      { id: 'svc-b', name: 'Service B', repositoryId: 'repo-1', addedAt: '', addedBy: '' },
    ],
    edges: [
      {
        id: 'edge-1',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-b',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
    ],
  };

  const groupStore: GroupStore = {
    version: 1,
    groups: [{ id: 'group-1', name: 'Test Group', createdAt: '', createdBy: '' }],
    orgs: [
      { id: 'org-a', groupId: 'group-1', name: 'Org A', tenantId: 'tenant-a', trustTier: 'participant', addedAt: '', addedBy: '' },
    ],
    sharingPolicies: [],
  };

  const rules = deriveRulesFromTopology(topologyStore, groupStore);
  assert.equal(rules.length, 0);
});

test('deriveRulesFromTopology skips non-depends_on edges', () => {
  const topologyStore: TopologyStore = {
    version: 1,
    repositories: [
      { id: 'repo-1', name: 'Repo 1', workspaceId: 'org-a', addedAt: '', addedBy: '' },
      { id: 'repo-2', name: 'Repo 2', workspaceId: 'org-b', addedAt: '', addedBy: '' },
    ],
    services: [
      { id: 'svc-a', name: 'A', repositoryId: 'repo-1', addedAt: '', addedBy: '' },
      { id: 'svc-b', name: 'B', repositoryId: 'repo-2', addedAt: '', addedBy: '' },
    ],
    edges: [
      {
        id: 'edge-1',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-b',
        toType: 'service',
        edgeType: 'calls', // not depends_on
        addedAt: '',
        addedBy: '',
      },
    ],
  };

  const groupStore: GroupStore = {
    version: 1,
    groups: [{ id: 'group-1', name: 'Test Group', createdAt: '', createdBy: '' }],
    orgs: [
      { id: 'org-a', groupId: 'group-1', name: 'Org A', tenantId: 'tenant-a', trustTier: 'participant', addedAt: '', addedBy: '' },
      { id: 'org-b', groupId: 'group-1', name: 'Org B', tenantId: 'tenant-b', trustTier: 'participant', addedAt: '', addedBy: '' },
    ],
    sharingPolicies: [],
  };

  const rules = deriveRulesFromTopology(topologyStore, groupStore);
  assert.equal(rules.length, 0);
});
