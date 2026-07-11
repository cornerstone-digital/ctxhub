import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { LanceDbIndex } from './LanceDbIndex.js';
import type { IndexedDocument } from '../config/types.js';

async function withIndex(run: (index: LanceDbIndex) => Promise<void>) {
  const dbPath = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-lancedb-'));
  try {
    await run(new LanceDbIndex(dbPath, 'ctxhub_chunks'));
  } finally {
    await rm(dbPath, { recursive: true, force: true });
  }
}

function doc(id: string, lastIndexed: string): IndexedDocument {
  return {
    id,
    workspace: 'ws',
    repo: 'app',
    filePath: `${id}.md`,
    absolutePath: `/tmp/${id}.md`,
    content: `content for ${id}`,
    hash: id,
    lastIndexed
  };
}

test('recent() returns documents most-recently-indexed first, not insertion order', () => {
  return withIndex(async index => {
    await index.indexDocuments([
      doc('a', '2026-01-01T00:00:00.000Z'),
      doc('c', '2026-01-03T00:00:00.000Z'),
      doc('b', '2026-01-02T00:00:00.000Z')
    ]);

    const docs = await index.recent(10);
    assert.deepEqual(
      docs.map(d => d.id),
      ['c', 'b', 'a']
    );
  });
});

test('recent(limit) respects the requested limit after sorting, not before', () => {
  return withIndex(async index => {
    // Deliberately inserted oldest-first, the opposite of what recent() should return -- a
    // pre-sort limit bug (see LanceDbIndex.recent()'s history: it used to cap the raw query at
    // 10000 rows *before* sorting) would silently keep the wrong end of this list.
    const docs: IndexedDocument[] = [];
    for (let i = 0; i < 25; i++) {
      docs.push(doc(`doc-${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));
    }
    await index.indexDocuments(docs);

    const recent = await index.recent(5);
    assert.deepEqual(
      recent.map(d => d.id),
      ['doc-24', 'doc-23', 'doc-22', 'doc-21', 'doc-20']
    );
  });
});

test('recent() on an empty/missing table returns an empty array rather than throwing', () => {
  return withIndex(async index => {
    const docs = await index.recent(10);
    assert.deepEqual(docs, []);
  });
});

test('search() finds a document by lexical content match', () => {
  return withIndex(async index => {
    await index.indexDocuments([
      doc('auth', '2026-01-01T00:00:00.000Z'),
      { ...doc('billing', '2026-01-01T00:00:00.000Z'), content: 'invoices and payment processing' }
    ]);

    const results = await index.search('payment processing', 5);
    assert.ok(results.some(r => r.id === 'billing'));
  });
});
