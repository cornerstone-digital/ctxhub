import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { LocalJsonMemory } from './LocalJsonMemory.js';
import type { IndexedDocument } from '../config/types.js';

async function withTempStore(run: (storePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devctx-memory-'));
  try {
    await run(path.join(dir, 'store.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeDoc(overrides: Partial<IndexedDocument> = {}): IndexedDocument {
  return {
    id: 'doc-1',
    workspace: 'ws',
    repo: 'app',
    filePath: 'README.md',
    absolutePath: '/tmp/README.md',
    title: 'Authentication flow',
    content: 'This describes the auth flow in detail.',
    hash: 'abc123',
    lastIndexed: new Date().toISOString(),
    ...overrides
  };
}

test('LocalJsonMemory upserts and finds chunks by lexical search', () => {
  return withTempStore(async storePath => {
    const memory = new LocalJsonMemory(storePath);
    await memory.upsertChunks([makeDoc()]);

    const results = await memory.search('authentication');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'doc-1');
    assert.match(results[0].snippet, /auth flow/);
  });
});

test('LocalJsonMemory search returns nothing for unmatched terms', () => {
  return withTempStore(async storePath => {
    const memory = new LocalJsonMemory(storePath);
    await memory.upsertChunks([makeDoc()]);

    const results = await memory.search('nonexistent-term');
    assert.equal(results.length, 0);
  });
});

test('LocalJsonMemory deleteChunks removes documents', () => {
  return withTempStore(async storePath => {
    const memory = new LocalJsonMemory(storePath);
    await memory.upsertChunks([makeDoc()]);
    await memory.deleteChunks(['doc-1']);

    const status = await memory.status();
    assert.equal(status.documentCount, 0);
  });
});

test('LocalJsonMemory clear empties the store', () => {
  return withTempStore(async storePath => {
    const memory = new LocalJsonMemory(storePath);
    await memory.upsertChunks([makeDoc(), makeDoc({ id: 'doc-2' })]);
    await memory.clear();

    const status = await memory.status();
    assert.equal(status.documentCount, 0);
    assert.equal(status.provider, 'local-json');
  });
});
