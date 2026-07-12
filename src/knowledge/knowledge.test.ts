import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  loadKnowledgeStore,
  saveKnowledgeStore,
  findKnowledgeObject,
  listKnowledgeObjects,
  getKnowledgeStorePath,
} from './store.js';
import type { KnowledgeObject, KnowledgeStore } from './types.js';

async function withTempStorePath(run: (storePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-knowledge-'));
  try {
    await run(path.join(dir, 'ws1.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeKO(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'ws1',
    title: 'Test knowledge',
    content: 'Some content',
    state: 'draft',
    confidence: 0.5,
    corroborations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'cli',
    ...overrides,
  };
}

test('loadKnowledgeStore returns empty store when no file exists', () => {
  return withTempStorePath(async storePath => {
    const store = await loadKnowledgeStore('ws1', storePath);
    assert.deepEqual(store, { version: 1, objects: [], edges: [], concepts: [] });
  });
});

test('listKnowledgeObjects filters by state correctly', () => {
  return withTempStorePath(async _storePath => {
    const store: KnowledgeStore = {
      version: 1,
      objects: [
        makeKO({ state: 'draft' }),
        makeKO({ state: 'active' }),
        makeKO({ state: 'draft' }),
        makeKO({ state: 'archived' }),
      ],
    };

    const drafts = listKnowledgeObjects(store, { state: 'draft' });
    assert.equal(drafts.length, 2);
    assert.ok(drafts.every(o => o.state === 'draft'));

    const actives = listKnowledgeObjects(store, { state: 'active' });
    assert.equal(actives.length, 1);
    assert.equal(actives[0].state, 'active');

    const all = listKnowledgeObjects(store);
    assert.equal(all.length, 4);
  });
});

test('listKnowledgeObjects filters by tag correctly', () => {
  return withTempStorePath(async _storePath => {
    const store: KnowledgeStore = {
      version: 1,
      objects: [
        makeKO({ tags: ['security', 'auth'] }),
        makeKO({ tags: ['performance'] }),
        makeKO({ tags: ['security'] }),
      ],
    };

    const securityObjects = listKnowledgeObjects(store, { tag: 'security' });
    assert.equal(securityObjects.length, 2);

    const perfObjects = listKnowledgeObjects(store, { tag: 'performance' });
    assert.equal(perfObjects.length, 1);

    const missingTag = listKnowledgeObjects(store, { tag: 'nonexistent' });
    assert.equal(missingTag.length, 0);
  });
});

test('findKnowledgeObject returns undefined for unknown id', () => {
  return withTempStorePath(async _storePath => {
    const store: KnowledgeStore = {
      version: 1,
      objects: [makeKO({ id: 'aaaabbbb-1234-5678-9abc-def012345678' })],
    };
    assert.equal(findKnowledgeObject(store, 'nonexistent-id'), undefined);
  });
});

test('findKnowledgeObject finds by full id and prefix', () => {
  return withTempStorePath(async _storePath => {
    const id = 'aaaabbbb-1234-5678-9abc-def012345678';
    const store: KnowledgeStore = {
      version: 1,
      objects: [makeKO({ id })],
    };
    assert.ok(findKnowledgeObject(store, id));
    assert.ok(findKnowledgeObject(store, 'aaaabbbb'));
    assert.equal(findKnowledgeObject(store, 'ccccdddd'), undefined);
  });
});

test('creating and promoting a KO changes state to active', () => {
  return withTempStorePath(async storePath => {
    const store: KnowledgeStore = { version: 1, objects: [] };

    const ko = makeKO({ state: 'draft' });
    store.objects.push(ko);
    await saveKnowledgeStore('ws1', store, storePath);

    // Load and promote
    const loaded = await loadKnowledgeStore('ws1', storePath);
    const found = findKnowledgeObject(loaded, ko.id);
    assert.ok(found);
    assert.equal(found.state, 'draft');

    found.state = 'active';
    found.updatedAt = new Date().toISOString();
    await saveKnowledgeStore('ws1', loaded, storePath);

    // Reload and verify
    const reloaded = await loadKnowledgeStore('ws1', storePath);
    const promoted = findKnowledgeObject(reloaded, ko.id);
    assert.ok(promoted);
    assert.equal(promoted.state, 'active');
  });
});

test('archiving sets archiveReason', () => {
  return withTempStorePath(async storePath => {
    const store: KnowledgeStore = { version: 1, objects: [] };
    const ko = makeKO({ state: 'active' });
    store.objects.push(ko);
    await saveKnowledgeStore('ws1', store, storePath);

    const loaded = await loadKnowledgeStore('ws1', storePath);
    const found = findKnowledgeObject(loaded, ko.id);
    assert.ok(found);

    found.state = 'archived';
    found.archiveReason = 'No longer relevant';
    found.updatedAt = new Date().toISOString();
    await saveKnowledgeStore('ws1', loaded, storePath);

    const reloaded = await loadKnowledgeStore('ws1', storePath);
    const archived = findKnowledgeObject(reloaded, ko.id);
    assert.ok(archived);
    assert.equal(archived.state, 'archived');
    assert.equal(archived.archiveReason, 'No longer relevant');
  });
});

test('getKnowledgeStorePath builds path under CTXHUB_HOME', () => {
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = '/tmp/test-ctxhub';
  try {
    const p = getKnowledgeStorePath('myworkspace');
    assert.equal(p, '/tmp/test-ctxhub/knowledge/myworkspace.json');
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
  }
});
