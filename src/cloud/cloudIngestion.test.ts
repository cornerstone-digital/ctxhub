import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createCloudServer, createInMemoryStore, type CloudStore } from './service.js';

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

const ADMIN_KEY = 'admin-secret-key';
const ORG_API_KEY = 'org-api-key-1';
const ORG_ID = 'test-org-id';

function makeStore(): CloudStore {
  const store = createInMemoryStore();
  store.adminKeys.add(ADMIN_KEY);
  const org = { id: ORG_ID, name: 'Test Org', slug: 'test-org', createdAt: new Date().toISOString() };
  store.orgs.set(ORG_ID, org);
  store.apiKeys.set(ORG_API_KEY, ORG_ID);
  return store;
}

// ── POST /sync/events ─────────────────────────────────────────────────────────

describe('POST /sync/events', () => {
  it('returns 401 without API key', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: ORG_ID, events: [] }),
      });
      assert.equal(res.status, 401);
    });
  });

  it('returns accepted count', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_API_KEY}` },
        body: JSON.stringify({
          orgId: ORG_ID,
          events: [
            { type: 'captain.run.completed', ts: new Date().toISOString(), sub: 'user-1' },
            { type: 'knowledge.promoted', ts: new Date().toISOString(), email: 'alice@example.com' },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { accepted: number };
      assert.equal(body.accepted, 2);
    });
  });

  it('stores events in the in-memory store', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await fetch(`${baseUrl}/sync/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_API_KEY}` },
        body: JSON.stringify({
          orgId: ORG_ID,
          events: [{ type: 'test.event', ts: '2024-01-01T00:00:00Z' }],
        }),
      });
      assert.equal(store.events.length, 1);
      assert.equal(store.events[0]?.orgId, ORG_ID);
      assert.equal(store.events[0]?.type, 'test.event');
    });
  });

  it('returns 400 when orgId is missing', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_API_KEY}` },
        body: JSON.stringify({ events: [] }),
      });
      assert.equal(res.status, 400);
    });
  });
});

// ── POST /sync/runs ───────────────────────────────────────────────────────────

describe('POST /sync/runs', () => {
  it('stores runs and returns accepted count', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_API_KEY}` },
        body: JSON.stringify({
          orgId: ORG_ID,
          workspaceId: 'ws-1',
          runs: [
            {
              id: 'run-1',
              taskName: 'security-review',
              startedAt: '2024-01-01T10:00:00Z',
              completedAt: '2024-01-01T10:05:00Z',
              status: 'completed',
              findingsCount: 3,
              promotedCount: 1,
            },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { accepted: number };
      assert.equal(body.accepted, 1);
      assert.equal(store.runs.length, 1);
      assert.equal(store.runs[0]?.taskName, 'security-review');
      assert.equal(store.runs[0]?.orgId, ORG_ID);
    });
  });

  it('returns 400 when workspaceId is missing', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_API_KEY}` },
        body: JSON.stringify({ orgId: ORG_ID, runs: [] }),
      });
      assert.equal(res.status, 400);
    });
  });
});

// ── POST /sync/notes ──────────────────────────────────────────────────────────

describe('POST /sync/notes', () => {
  it('stores notes and returns accepted count', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_API_KEY}` },
        body: JSON.stringify({
          orgId: ORG_ID,
          workspaceId: 'ws-1',
          notes: [
            {
              id: 'note-1',
              title: 'Security findings Q1',
              content: 'We found several XSS issues.',
              promotedAt: '2024-01-01T10:00:00Z',
              promotedBy: 'alice',
              trustTier: 'institutional',
            },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { accepted: number };
      assert.equal(body.accepted, 1);
      assert.equal(store.notes.length, 1);
      assert.equal(store.notes[0]?.title, 'Security findings Q1');
      assert.equal(store.notes[0]?.orgId, ORG_ID);
    });
  });
});

// ── GET /sync/history ─────────────────────────────────────────────────────────

describe('GET /sync/history', () => {
  it('returns combined history for the org', async () => {
    const store = makeStore();
    store.events.push({ type: 'test.event', ts: '2024-01-01T00:00:00Z', orgId: ORG_ID });
    store.runs.push({
      id: 'run-1', orgId: ORG_ID, workspaceId: 'ws-1',
      taskName: 'security-review', startedAt: '2024-01-01T10:00:00Z',
      status: 'completed', findingsCount: 1, promotedCount: 0,
      syncedAt: new Date().toISOString(),
    });
    store.notes.push({
      id: 'note-1', orgId: ORG_ID, workspaceId: 'ws-1',
      title: 'Test note', content: 'Test content',
      promotedAt: '2024-01-01T00:00:00Z', promotedBy: 'alice',
      trustTier: 'institutional', syncedAt: new Date().toISOString(),
    });

    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/history?orgId=${ORG_ID}`, {
        headers: { Authorization: `Bearer ${ORG_API_KEY}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { events: unknown[]; runs: unknown[]; notes: unknown[] };
      assert.equal(body.events.length, 1);
      assert.equal(body.runs.length, 1);
      assert.equal(body.notes.length, 1);
    });
  });

  it('filters by type=runs', async () => {
    const store = makeStore();
    store.events.push({ type: 'test.event', ts: '2024-01-01T00:00:00Z', orgId: ORG_ID });
    store.runs.push({
      id: 'run-1', orgId: ORG_ID, workspaceId: 'ws-1',
      taskName: 'security-review', startedAt: '2024-01-01T10:00:00Z',
      status: 'completed', findingsCount: 1, promotedCount: 0,
      syncedAt: new Date().toISOString(),
    });

    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/history?orgId=${ORG_ID}&type=runs`, {
        headers: { Authorization: `Bearer ${ORG_API_KEY}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { events: unknown[]; runs: unknown[]; notes: unknown[] };
      assert.equal(body.events.length, 0);
      assert.equal(body.runs.length, 1);
      assert.equal(body.notes.length, 0);
    });
  });

  it('returns 401 without API key', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/sync/history?orgId=${ORG_ID}`);
      assert.equal(res.status, 401);
    });
  });
});
