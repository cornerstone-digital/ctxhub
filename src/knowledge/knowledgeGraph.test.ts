import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeStore } from './types.js';
import {
  findEdge,
  getEdgesForObject,
  findConcept,
  findConceptByName,
  getObjectsForConcept,
} from './store.js';

function makeStore(): KnowledgeStore {
  return {
    version: 1,
    objects: [
      {
        id: 'obj-aaaa',
        workspaceId: 'ws1',
        title: 'First object',
        content: 'First content',
        state: 'active',
        confidence: 0.8,
        corroborations: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        createdBy: 'test',
      },
      {
        id: 'obj-bbbb',
        workspaceId: 'ws1',
        title: 'Second object',
        content: 'Second content',
        state: 'active',
        confidence: 0.9,
        corroborations: [],
        createdAt: '2025-01-02T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        createdBy: 'test',
      },
    ],
    edges: [
      {
        id: 'edge-1111',
        fromId: 'obj-aaaa',
        toId: 'obj-bbbb',
        edgeType: 'supports',
        confidence: 0.9,
        createdAt: '2025-01-01T00:00:00.000Z',
        createdBy: 'test',
      },
      {
        id: 'edge-2222',
        fromId: 'obj-bbbb',
        toId: 'obj-aaaa',
        edgeType: 'related_to',
        confidence: 0.7,
        createdAt: '2025-01-02T00:00:00.000Z',
        createdBy: 'test',
      },
      {
        id: 'edge-3333',
        fromId: 'obj-aaaa',
        toId: 'obj-aaaa', // self edge (edge case)
        edgeType: 'contradicts',
        confidence: 0.1,
        createdAt: '2025-01-03T00:00:00.000Z',
        createdBy: 'test',
      },
    ],
    concepts: [
      {
        id: 'concept-cccc',
        name: 'database selection',
        description: 'Which DB to use',
        relatedObjectIds: ['obj-aaaa', 'obj-bbbb'],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'concept-dddd',
        name: 'authentication',
        relatedObjectIds: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
  };
}

test('empty store initialises with edges: [] and concepts: []', () => {
  const store: KnowledgeStore = { version: 1, objects: [], edges: [], concepts: [] };
  assert.deepEqual(store.edges, []);
  assert.deepEqual(store.concepts, []);
});

test('getEdgesForObject returns edges in both directions', () => {
  const store = makeStore();
  const edges = getEdgesForObject(store, 'obj-aaaa');
  // obj-aaaa appears as fromId in edge-1111, edge-3333 and as toId in edge-2222
  assert.equal(edges.length, 3);
  const ids = edges.map(e => e.id);
  assert.ok(ids.includes('edge-1111'));
  assert.ok(ids.includes('edge-2222'));
  assert.ok(ids.includes('edge-3333'));
});

test('getEdgesForObject returns empty array for unknown object', () => {
  const store = makeStore();
  const edges = getEdgesForObject(store, 'obj-xxxx');
  assert.equal(edges.length, 0);
});

test('findEdge finds by full id', () => {
  const store = makeStore();
  const edge = findEdge(store, 'edge-1111');
  assert.ok(edge);
  assert.equal(edge.id, 'edge-1111');
});

test('findEdge finds by prefix', () => {
  const store = makeStore();
  const edge = findEdge(store, 'edge-1');
  assert.ok(edge);
  assert.equal(edge.id, 'edge-1111');
});

test('findConceptByName returns the matching concept', () => {
  const store = makeStore();
  const concept = findConceptByName(store, 'database selection');
  assert.ok(concept);
  assert.equal(concept.name, 'database selection');
});

test('findConceptByName is case-insensitive', () => {
  const store = makeStore();
  const concept = findConceptByName(store, 'Database Selection');
  assert.ok(concept);
  assert.equal(concept.name, 'database selection');
});

test('findConceptByName returns undefined when not found', () => {
  const store = makeStore();
  const concept = findConceptByName(store, 'nonexistent concept');
  assert.equal(concept, undefined);
});

test('getObjectsForConcept returns linked object IDs', () => {
  const store = makeStore();
  const ids = getObjectsForConcept(store, 'concept-cccc');
  assert.deepEqual(ids, ['obj-aaaa', 'obj-bbbb']);
});

test('getObjectsForConcept returns empty array for concept with no links', () => {
  const store = makeStore();
  const ids = getObjectsForConcept(store, 'concept-dddd');
  assert.deepEqual(ids, []);
});

test('getObjectsForConcept returns empty array for unknown concept id', () => {
  const store = makeStore();
  const ids = getObjectsForConcept(store, 'concept-xxxx');
  assert.deepEqual(ids, []);
});
