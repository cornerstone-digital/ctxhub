import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { getSyncConfig, syncToCloud, syncKnowledgeToCloud } from './sync.js';
import { writeText } from '../utils/fs.js';
import type { IndexedDocument } from '../config/types.js';
import type { KnowledgeObject } from '../knowledge/types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-cloud-sync-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = ctxhubHome;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(ctxhubHome, { recursive: true, force: true });
  }
}

function withCleanEnv(run: () => Promise<void>) {
  const origEndpoint = process.env.CTXHUB_CLOUD_ENDPOINT;
  const origApiKey = process.env.CTXHUB_CLOUD_API_KEY;
  delete process.env.CTXHUB_CLOUD_ENDPOINT;
  delete process.env.CTXHUB_CLOUD_API_KEY;
  return run().finally(() => {
    if (origEndpoint !== undefined) process.env.CTXHUB_CLOUD_ENDPOINT = origEndpoint;
    else delete process.env.CTXHUB_CLOUD_ENDPOINT;
    if (origApiKey !== undefined) process.env.CTXHUB_CLOUD_API_KEY = origApiKey;
    else delete process.env.CTXHUB_CLOUD_API_KEY;
  });
}

function makeChunk(overrides: Partial<IndexedDocument> = {}): IndexedDocument {
  return {
    id: crypto.randomUUID(),
    workspace: 'ws',
    repo: 'repo',
    filePath: 'file.md',
    absolutePath: '/workspace/file.md',
    title: 'Test',
    content: 'content',
    hash: 'abc123',
    type: 'text',
    size: 100,
    mtime: Date.now(),
    trustTier: 'unverified',
    ...overrides,
  } as IndexedDocument;
}

// ── getSyncConfig ─────────────────────────────────────────────────────────────

test('getSyncConfig returns null when neither env vars nor file are present', () => {
  return withIsolatedCtxhubHome(() =>
    withCleanEnv(async () => {
      const config = await getSyncConfig();
      assert.equal(config, null);
    })
  );
});

test('getSyncConfig reads endpoint and apiKey from env vars', () => {
  return withIsolatedCtxhubHome(() =>
    withCleanEnv(async () => {
      process.env.CTXHUB_CLOUD_ENDPOINT = 'https://cloud.example.com';
      process.env.CTXHUB_CLOUD_API_KEY = 'test-key-123';
      const config = await getSyncConfig();
      assert.ok(config !== null);
      assert.equal(config.endpoint, 'https://cloud.example.com');
      assert.equal(config.apiKey, 'test-key-123');
    })
  );
});

test('getSyncConfig reads from cloud.json file when env vars are absent', () => {
  return withIsolatedCtxhubHome(() =>
    withCleanEnv(async () => {
      const cloudJsonPath = path.join(process.env.CTXHUB_HOME!, 'cloud.json');
      await writeText(
        cloudJsonPath,
        JSON.stringify({ endpoint: 'https://file.example.com', apiKey: 'file-key' })
      );
      const config = await getSyncConfig();
      assert.ok(config !== null);
      assert.equal(config.endpoint, 'https://file.example.com');
      assert.equal(config.apiKey, 'file-key');
    })
  );
});

test('getSyncConfig returns null when endpoint is set but api key is missing', () => {
  return withIsolatedCtxhubHome(() =>
    withCleanEnv(async () => {
      process.env.CTXHUB_CLOUD_ENDPOINT = 'https://cloud.example.com';
      // No CTXHUB_CLOUD_API_KEY, no file either
      const config = await getSyncConfig();
      assert.equal(config, null);
    })
  );
});

test('getSyncConfig env vars take precedence over cloud.json file', () => {
  return withIsolatedCtxhubHome(() =>
    withCleanEnv(async () => {
      const cloudJsonPath = path.join(process.env.CTXHUB_HOME!, 'cloud.json');
      await writeText(
        cloudJsonPath,
        JSON.stringify({ endpoint: 'https://file.example.com', apiKey: 'file-key' })
      );
      process.env.CTXHUB_CLOUD_ENDPOINT = 'https://env.example.com';
      process.env.CTXHUB_CLOUD_API_KEY = 'env-key';
      const config = await getSyncConfig();
      assert.ok(config !== null);
      assert.equal(config.endpoint, 'https://env.example.com', 'env var endpoint should win');
      assert.equal(config.apiKey, 'env-key', 'env var apiKey should win');
    })
  );
});

// ── syncToCloud ───────────────────────────────────────────────────────────────

test('syncToCloud returns skipped when endpoint is empty', async () => {
  const result = await syncToCloud({ endpoint: '', apiKey: 'key' }, []);
  assert.equal(result.skipped, true);
  assert.ok(result.reason?.includes('not configured') || result.reason?.includes('no institutional'));
});

test('syncToCloud returns skipped when no institutional or canonical chunks', async () => {
  const chunks = [
    makeChunk({ trustTier: 'unverified' }),
    makeChunk({ trustTier: 'reviewed' }),
    makeChunk({ trustTier: 'promoted' }),
  ];
  const result = await syncToCloud({ endpoint: 'https://cloud.example.com', apiKey: 'key' }, chunks);
  assert.equal(result.skipped, true);
  assert.ok(result.reason?.includes('no institutional or canonical'));
});

test('syncToCloud only sends institutional and canonical tier chunks', async () => {
  // Track what payload was sent
  let capturedBody: unknown = null;
  const originalFetch = globalThis.fetch;
  // @ts-expect-error — monkey-patching for test
  globalThis.fetch = async (url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return { ok: true, json: async () => ({ synced: 2, failed: 0, errors: [] }) } as Response;
  };

  try {
    const chunks = [
      makeChunk({ trustTier: 'unverified' }),
      makeChunk({ trustTier: 'institutional' }),
      makeChunk({ trustTier: 'canonical' }),
      makeChunk({ trustTier: 'reviewed' }),
    ];
    const result = await syncToCloud({ endpoint: 'https://cloud.example.com', apiKey: 'key' }, chunks);
    assert.equal(result.skipped, undefined, 'should not be skipped');
    assert.equal(result.synced, 2);
    assert.ok(capturedBody !== null, 'should have sent a request');
    const body = capturedBody as { chunks: Array<{ trustTier: string }> };
    assert.equal(body.chunks.length, 2, 'should only include 2 chunks (institutional + canonical)');
    assert.ok(body.chunks.every(c => c.trustTier === 'institutional' || c.trustTier === 'canonical'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncToCloud returns error result when cloud API returns non-OK', async () => {
  const originalFetch = globalThis.fetch;
  // @ts-expect-error — monkey-patching for test
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => 'Unauthorized',
  } as Response);

  try {
    const chunks = [makeChunk({ trustTier: 'institutional' })];
    const result = await syncToCloud({ endpoint: 'https://cloud.example.com', apiKey: 'bad-key' }, chunks);
    assert.equal(result.synced, 0);
    assert.ok((result.failed ?? 0) > 0);
    assert.ok(result.errors?.some(e => e.includes('403')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncToCloud handles network errors gracefully', async () => {
  const originalFetch = globalThis.fetch;
  // @ts-expect-error — monkey-patching for test
  globalThis.fetch = async () => { throw new Error('Network unreachable'); };

  try {
    const chunks = [makeChunk({ trustTier: 'canonical' })];
    const result = await syncToCloud({ endpoint: 'https://cloud.example.com', apiKey: 'key' }, chunks);
    assert.equal(result.synced, 0);
    assert.ok((result.failed ?? 0) > 0);
    assert.ok(result.errors?.some(e => e.includes('Network unreachable')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── syncKnowledgeToCloud ─────────────────────────────────────────────────────

function makeKnowledgeObject(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'ws',
    title: 'Finding',
    content: 'body text',
    state: 'active',
    confidence: 1.0,
    corroborations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'user-1',
    ...overrides,
  };
}

test('syncKnowledgeToCloud skips when endpoint is empty', async () => {
  const result = await syncKnowledgeToCloud({ endpoint: '', apiKey: 'key' }, 'ws', []);
  assert.equal(result.skipped, true);
});

test('syncKnowledgeToCloud excludes draft objects', async () => {
  let capturedBody: unknown = null;
  const originalFetch = globalThis.fetch;
  // @ts-expect-error — monkey-patching for test
  globalThis.fetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return { ok: true, json: async () => ({ synced: 1 }) } as Response;
  };

  try {
    const objects = [makeKnowledgeObject({ state: 'draft' }), makeKnowledgeObject({ state: 'active' })];
    const result = await syncKnowledgeToCloud({ endpoint: 'https://cloud.example.com', apiKey: 'key' }, 'ws', objects);
    assert.equal('synced' in result && result.synced, 1);
    const body = capturedBody as { workspaceId: string; objects: Array<{ state: string }> };
    assert.equal(body.workspaceId, 'ws');
    assert.equal(body.objects.length, 1);
    assert.equal(body.objects[0]!.state, 'active');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncKnowledgeToCloud skips when all objects are drafts', async () => {
  const result = await syncKnowledgeToCloud(
    { endpoint: 'https://cloud.example.com', apiKey: 'key' },
    'ws',
    [makeKnowledgeObject({ state: 'draft' })],
  );
  assert.equal(result.skipped, true);
});

test('syncKnowledgeToCloud throws on a non-OK response', async () => {
  const originalFetch = globalThis.fetch;
  // @ts-expect-error — monkey-patching for test
  globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'Error', text: async () => 'boom' } as Response);

  try {
    await assert.rejects(
      () => syncKnowledgeToCloud({ endpoint: 'https://cloud.example.com', apiKey: 'key' }, 'ws', [makeKnowledgeObject()]),
      /500/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
