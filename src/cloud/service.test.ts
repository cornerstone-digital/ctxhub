import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createCloudServer, createInMemoryStore, type CloudStore } from './service.js';
import { getPackageVersion } from '../utils/version.js';

// ── helpers ───────────────────────────────────────────────────────────────────

async function withRunningCloudServer(
  store: CloudStore,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createCloudServer(store);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function makeStore(opts: { adminKey?: string; orgApiKey?: string; orgId?: string } = {}): CloudStore {
  const store = createInMemoryStore();
  const adminKey = opts.adminKey ?? 'admin-key-123';
  const orgApiKey = opts.orgApiKey ?? 'org-api-key-456';
  const orgId = opts.orgId ?? 'org-id-001';
  store.adminKeys.add(adminKey);
  if (orgApiKey && orgId) {
    store.orgs.set(orgId, { id: orgId, name: 'Test Org', slug: 'test-org', createdAt: new Date().toISOString() });
    store.apiKeys.set(orgApiKey, orgId);
  }
  return store;
}

// ── GET /health ───────────────────────────────────────────────────────────────

test('GET /health returns ok:true and a version string', async () => {
  const store = createInMemoryStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; version: string };
    assert.equal(body.ok, true);
    assert.equal(body.version, getPackageVersion());
  });
});

// ── POST /orgs ────────────────────────────────────────────────────────────────

test('POST /orgs registers a new org (admin key)', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-key-123' },
      body: JSON.stringify({ name: 'New Corp', slug: 'new-corp', orgApiKey: 'new-corp-key' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { org: { name: string; slug: string } };
    assert.equal(body.org.name, 'New Corp');
    assert.equal(body.org.slug, 'new-corp');
  });
});

test('POST /orgs returns 401 without admin key', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bad-key' },
      body: JSON.stringify({ name: 'Corp', slug: 'corp' }),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /orgs returns 409 for duplicate slug', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    // First registration succeeds
    await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-key-123' },
      body: JSON.stringify({ name: 'Unique Corp', slug: 'unique-corp' }),
    });
    // Second with same slug should conflict
    const res = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-key-123' },
      body: JSON.stringify({ name: 'Other Corp', slug: 'unique-corp' }),
    });
    assert.equal(res.status, 409);
  });
});

// ── POST /sync ────────────────────────────────────────────────────────────────

test('POST /sync stores institutional chunks', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer org-api-key-456' },
      body: JSON.stringify({
        orgId: 'org-id-001',
        workspaceId: 'ws-1',
        chunks: [
          { contentHash: 'hash-a', title: 'Doc A', body: 'content a', trustTier: 'institutional' },
          { contentHash: 'hash-b', title: 'Doc B', body: 'content b', trustTier: 'canonical' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { synced: number };
    assert.equal(body.synced, 2);
    assert.equal(store.chunks.size, 2);
  });
});

test('POST /sync rejects request with invalid API key', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
      body: JSON.stringify({ orgId: 'org-id-001', chunks: [] }),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /sync filters out non-institutional/canonical chunks', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer org-api-key-456' },
      body: JSON.stringify({
        orgId: 'org-id-001',
        chunks: [
          { contentHash: 'hash-1', body: 'unverified', trustTier: 'unverified' },
          { contentHash: 'hash-2', body: 'reviewed', trustTier: 'reviewed' },
          { contentHash: 'hash-3', body: 'promoted', trustTier: 'promoted' },
          { contentHash: 'hash-4', body: 'institutional', trustTier: 'institutional' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { synced: number };
    assert.equal(body.synced, 1, 'only institutional chunk should be synced');
    assert.equal(store.chunks.size, 1);
  });
});

test('POST /sync returns 400 when orgId is missing', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer org-api-key-456' },
      body: JSON.stringify({ chunks: [] }), // missing orgId
    });
    assert.equal(res.status, 400);
  });
});

// ── GET /search ───────────────────────────────────────────────────────────────

test('GET /search returns matching chunks for an org', async () => {
  const store = makeStore();
  // Pre-populate store with chunks
  store.chunks.set('org-id-001:hash-search-1', {
    contentHash: 'hash-search-1',
    orgId: 'org-id-001',
    body: 'how to configure the rate limiter',
    trustTier: 'institutional',
    syncedAt: new Date().toISOString(),
  });
  store.chunks.set('org-id-001:hash-search-2', {
    contentHash: 'hash-search-2',
    orgId: 'org-id-001',
    body: 'unrelated content about databases',
    trustTier: 'canonical',
    syncedAt: new Date().toISOString(),
  });

  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/search?q=rate+limiter&orgId=org-id-001`, {
      headers: { Authorization: 'Bearer org-api-key-456' },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { results: Array<{ contentHash: string }>; count: number };
    assert.equal(body.count, 1);
    assert.equal(body.results[0]!.contentHash, 'hash-search-1');
  });
});

test('GET /search returns 400 when q is missing', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/search?orgId=org-id-001`, {
      headers: { Authorization: 'Bearer org-api-key-456' },
    });
    assert.equal(res.status, 400);
  });
});

test('GET /search returns 401 without API key', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/search?q=test&orgId=org-id-001`);
    assert.equal(res.status, 401);
  });
});

// ── GET /orgs/:id/workspaces ──────────────────────────────────────────────────

test('GET /orgs/:id/workspaces returns empty list for org with no workspaces', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/orgs/org-id-001/workspaces`, {
      headers: { Authorization: 'Bearer org-api-key-456' },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { workspaces: unknown[] };
    assert.deepEqual(body.workspaces, []);
  });
});

test('GET /orgs/:id/workspaces returns 404 for unknown org', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/orgs/no-such-org/workspaces`, {
      headers: { Authorization: 'Bearer org-api-key-456' },
    });
    assert.equal(res.status, 404);
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────

test('unknown routes return 404', async () => {
  const store = createInMemoryStore();
  await withRunningCloudServer(store, async baseUrl => {
    const res = await fetch(`${baseUrl}/no-such-route`);
    assert.equal(res.status, 404);
  });
});
