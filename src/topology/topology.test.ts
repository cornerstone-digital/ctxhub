import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  loadTopologyStore,
  saveTopologyStore,
  getEdgesFrom,
  getTransitiveDependencies,
} from './store.js';
import type { TopologyStore } from './types.js';

async function withTempPath(run: (storePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-topology-'));
  try {
    await run(path.join(dir, 'topology.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadTopologyStore returns empty store when no file exists', () => {
  return withTempPath(async storePath => {
    const store = await loadTopologyStore(storePath);
    assert.deepEqual(store, { version: 1, repositories: [], services: [], edges: [] });
  });
});

test('getEdgesFrom returns only edges with matching fromId', () => {
  return withTempPath(async storePath => {
    const store: TopologyStore = {
      version: 1,
      repositories: [],
      services: [],
      edges: [
        {
          id: 'e1',
          fromId: 'svc-a',
          fromType: 'service',
          toId: 'svc-b',
          toType: 'service',
          edgeType: 'depends_on',
          addedAt: new Date().toISOString(),
          addedBy: 'test',
        },
        {
          id: 'e2',
          fromId: 'svc-b',
          fromType: 'service',
          toId: 'svc-c',
          toType: 'service',
          edgeType: 'calls',
          addedAt: new Date().toISOString(),
          addedBy: 'test',
        },
        {
          id: 'e3',
          fromId: 'svc-a',
          fromType: 'service',
          toId: 'svc-c',
          toType: 'service',
          edgeType: 'calls',
          addedAt: new Date().toISOString(),
          addedBy: 'test',
        },
      ],
    };

    await saveTopologyStore(store, storePath);
    const loaded = await loadTopologyStore(storePath);

    const edgesFromA = getEdgesFrom(loaded, 'svc-a');
    assert.equal(edgesFromA.length, 2);
    assert.ok(edgesFromA.every(e => e.fromId === 'svc-a'));

    const edgesFromB = getEdgesFrom(loaded, 'svc-b');
    assert.equal(edgesFromB.length, 1);
    assert.equal(edgesFromB[0].edgeType, 'calls');
  });
});

test('getTransitiveDependencies follows depends_on edges up to maxDepth', () => {
  const store: TopologyStore = {
    version: 1,
    repositories: [],
    services: [
      { id: 'svc-a', name: 'A', addedAt: '', addedBy: '' },
      { id: 'svc-b', name: 'B', addedAt: '', addedBy: '' },
      { id: 'svc-c', name: 'C', addedAt: '', addedBy: '' },
      { id: 'svc-d', name: 'D', addedAt: '', addedBy: '' },
    ],
    edges: [
      {
        id: 'e1',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-b',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
      {
        id: 'e2',
        fromId: 'svc-b',
        fromType: 'service',
        toId: 'svc-c',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
      {
        id: 'e3',
        fromId: 'svc-c',
        fromType: 'service',
        toId: 'svc-d',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
      // non-depends_on edge should NOT be followed
      {
        id: 'e4',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-d',
        toType: 'service',
        edgeType: 'calls',
        addedAt: '',
        addedBy: '',
      },
    ],
  };

  const deps = getTransitiveDependencies(store, 'svc-a', 3);
  const ids = deps.map(d => d.id);

  assert.ok(ids.includes('svc-b'), 'should include svc-b (depth 1)');
  assert.ok(ids.includes('svc-c'), 'should include svc-c (depth 2)');
  assert.ok(ids.includes('svc-d'), 'should include svc-d (depth 3)');

  // svc-d should not appear twice (once via calls is not counted)
  assert.equal(ids.filter(id => id === 'svc-d').length, 1);
});

test('getTransitiveDependencies does not loop on cycles', () => {
  const store: TopologyStore = {
    version: 1,
    repositories: [],
    services: [
      { id: 'svc-a', name: 'A', addedAt: '', addedBy: '' },
      { id: 'svc-b', name: 'B', addedAt: '', addedBy: '' },
    ],
    edges: [
      {
        id: 'e1',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-b',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
      // cycle: svc-b depends_on svc-a
      {
        id: 'e2',
        fromId: 'svc-b',
        fromType: 'service',
        toId: 'svc-a',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
    ],
  };

  const deps = getTransitiveDependencies(store, 'svc-a', 10);
  // Should only return svc-b once, not loop infinitely
  assert.equal(deps.length, 1);
  assert.equal(deps[0].id, 'svc-b');
});

test('getTransitiveDependencies respects maxDepth=1', () => {
  const store: TopologyStore = {
    version: 1,
    repositories: [],
    services: [
      { id: 'svc-a', name: 'A', addedAt: '', addedBy: '' },
      { id: 'svc-b', name: 'B', addedAt: '', addedBy: '' },
      { id: 'svc-c', name: 'C', addedAt: '', addedBy: '' },
    ],
    edges: [
      {
        id: 'e1',
        fromId: 'svc-a',
        fromType: 'service',
        toId: 'svc-b',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
      {
        id: 'e2',
        fromId: 'svc-b',
        fromType: 'service',
        toId: 'svc-c',
        toType: 'service',
        edgeType: 'depends_on',
        addedAt: '',
        addedBy: '',
      },
    ],
  };

  const deps = getTransitiveDependencies(store, 'svc-a', 1);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].id, 'svc-b');
  assert.equal(deps[0].depth, 1);
});
