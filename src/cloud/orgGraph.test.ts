import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createCloudServer, createInMemoryStore, type CloudStore } from './service.js';
import type { CloudKnowledgeObject } from './types.js';

async function withRunningCloudServer(store: CloudStore, run: (baseUrl: string) => Promise<void>) {
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
const ORG_A_KEY = 'org-a-key';
const ORG_A_ID = 'org-a';
const ORG_B_KEY = 'org-b-key';
const ORG_B_ID = 'org-b';

function makeStore(): CloudStore {
  const store = createInMemoryStore();
  store.adminKeys.add(ADMIN_KEY);
  store.orgs.set(ORG_A_ID, { id: ORG_A_ID, name: 'Org A', slug: 'org-a', createdAt: new Date().toISOString() });
  store.apiKeys.set(ORG_A_KEY, ORG_A_ID);
  store.orgs.set(ORG_B_ID, { id: ORG_B_ID, name: 'Org B', slug: 'org-b', createdAt: new Date().toISOString() });
  store.apiKeys.set(ORG_B_KEY, ORG_B_ID);
  return store;
}

function authHeaders(key: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

async function syncOneObject(baseUrl: string, key: string, workspaceId: string, overrides: Partial<{
  localId: string; title: string; body: string; state: string; confidence: number; reviewFlag: boolean;
}> = {}) {
  const res = await fetch(`${baseUrl}/sync/knowledge`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify({
      workspaceId,
      objects: [{
        localId: overrides.localId ?? 'ko-1',
        promotedBy: 'user-1',
        promotedAt: new Date().toISOString(),
        title: overrides.title ?? 'Auth uses JWT',
        body: overrides.body ?? 'The service authenticates requests with a signed JWT bearer token.',
        state: overrides.state ?? 'active',
        confidence: overrides.confidence ?? 1.0,
        reviewFlag: overrides.reviewFlag ?? false,
      }],
    }),
  });
  assert.equal(res.status, 200);
  return res.json() as Promise<{ synced: number }>;
}

// ── POST /sync/knowledge ────────────────────────────────────────────────────────

describe('POST /sync/knowledge', () => {
  it('syncs a knowledge object and is idempotent on (workspaceId, localId)', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const first = await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api');
      assert.equal(first.synced, 1);

      // Re-sync with an updated title -- should update in place, not duplicate.
      const second = await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { title: 'Auth uses JWT (updated)' });
      assert.equal(second.synced, 1);

      const listRes = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const listBody = await listRes.json() as { objects: CloudKnowledgeObject[] };
      assert.equal(listBody.objects.length, 1);
      assert.equal(listBody.objects[0]!.title, 'Auth uses JWT (updated)');
    });
  });

  it('does not overwrite Cloud-computed confidence on re-sync', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api');
      const listRes1 = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const [obj] = (await listRes1.json() as { objects: CloudKnowledgeObject[] }).objects;

      // A contradiction drops confidence below 1.0 via the Cloud API (not local sync).
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { localId: 'ko-2', title: 'Auth uses cookies' });
      const listRes2 = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const objects2 = (await listRes2.json() as { objects: CloudKnowledgeObject[] }).objects;
      const other = objects2.find(o => o.localId === 'ko-2')!;

      await fetch(`${baseUrl}/knowledge/${other.id}/edges`, {
        method: 'POST',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ toId: obj!.id, edgeType: 'contradicts' }),
      });

      // Re-sync the contradicted object from local -- confidence should still reflect the
      // Cloud-side contradiction penalty, not reset to the local static 1.0.
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api');
      const listRes3 = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const objects3 = (await listRes3.json() as { objects: CloudKnowledgeObject[] }).objects;
      const resynced = objects3.find(o => o.localId === 'ko-1')!;
      assert.ok(resynced.confidence < 1.0, `expected confidence < 1.0, got ${resynced.confidence}`);
      assert.equal(resynced.reviewFlag, true);
    });
  });
});

// ── GET /knowledge — cross-workspace query, org isolation ──────────────────────

describe('GET /knowledge', () => {
  it('returns objects from multiple workspaces within the same org', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { localId: 'a', title: 'API finding' });
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-web', { localId: 'b', title: 'Web finding' });

      const res = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const body = await res.json() as { objects: CloudKnowledgeObject[]; count: number };
      assert.equal(body.count, 2);
      assert.deepEqual(body.objects.map(o => o.workspaceId).sort(), ['ws-api', 'ws-web']);
    });
  });

  it('never returns another org\'s knowledge objects', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { title: 'Org A secret finding' });
      await syncOneObject(baseUrl, ORG_B_KEY, 'ws-api', { title: 'Org B secret finding' });

      const res = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const body = await res.json() as { objects: CloudKnowledgeObject[] };
      assert.equal(body.objects.length, 1);
      assert.equal(body.objects[0]!.title, 'Org A secret finding');
    });
  });

  it('filters by workspace, state, q, and minConfidence', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { localId: 'a', title: 'Rate limiting design', state: 'active' });
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { localId: 'b', title: 'Old cache strategy', state: 'archived' });
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-web', { localId: 'c', title: 'Rate limiting on web tier', state: 'active' });

      const byWorkspace = await fetch(`${baseUrl}/knowledge?workspace=ws-web`, { headers: authHeaders(ORG_A_KEY) });
      assert.equal((await byWorkspace.json() as { count: number }).count, 1);

      const byState = await fetch(`${baseUrl}/knowledge?state=archived`, { headers: authHeaders(ORG_A_KEY) });
      assert.equal((await byState.json() as { count: number }).count, 1);

      const byQuery = await fetch(`${baseUrl}/knowledge?q=rate+limiting`, { headers: authHeaders(ORG_A_KEY) });
      assert.equal((await byQuery.json() as { count: number }).count, 2);
    });
  });
});

// ── PATCH /knowledge/:id lifecycle ──────────────────────────────────────────────

describe('PATCH /knowledge/:id', () => {
  it('supersedes an object and links it to its successor', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { localId: 'old', title: 'Old design' });
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { localId: 'new', title: 'New design' });
      const listRes = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const objects = (await listRes.json() as { objects: CloudKnowledgeObject[] }).objects;
      const oldObj = objects.find(o => o.localId === 'old')!;
      const newObj = objects.find(o => o.localId === 'new')!;

      const patchRes = await fetch(`${baseUrl}/knowledge/${oldObj.id}`, {
        method: 'PATCH',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ action: 'supersede', supersededBy: newObj.id }),
      });
      assert.equal(patchRes.status, 200);
      const patched = (await patchRes.json() as { object: CloudKnowledgeObject }).object;
      assert.equal(patched.state, 'superseded');
      assert.equal(patched.supersededBy, newObj.id);

      const edgesRes = await fetch(`${baseUrl}/knowledge/${oldObj.id}/edges`, { headers: authHeaders(ORG_A_KEY) });
      const edges = (await edgesRes.json() as { edges: Array<{ edgeType: string }> }).edges;
      assert.ok(edges.some(e => e.edgeType === 'superseded_by'));
    });
  });

  it('reaffirm clears reviewFlag and nudges confidence up', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await syncOneObject(baseUrl, ORG_A_KEY, 'ws-api', { reviewFlag: true, confidence: 0.5 });
      const listRes = await fetch(`${baseUrl}/knowledge`, { headers: authHeaders(ORG_A_KEY) });
      const obj = (await listRes.json() as { objects: CloudKnowledgeObject[] }).objects[0]!;

      const res = await fetch(`${baseUrl}/knowledge/${obj.id}`, {
        method: 'PATCH',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ action: 'reaffirm' }),
      });
      const patched = (await res.json() as { object: CloudKnowledgeObject }).object;
      assert.equal(patched.reviewFlag, false);
      assert.ok(patched.confidence > 0.5);
      assert.equal(patched.corroborations, 1);
    });
  });
});

// ── Topology edges auto-derive cascade rules (ADR-007) ──────────────────────────

describe('POST /topology/edges and cascade rule derivation', () => {
  it('auto-creates a cascade rule for a workspace-to-workspace depends_on edge', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/topology/edges`, {
        method: 'POST',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ fromType: 'workspace', fromId: 'ws-web', toType: 'workspace', toId: 'ws-api', edgeType: 'depends_on' }),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as { edge: { id: string }; cascadeRule?: { basis: string; sourceWorkspaceId: string; targetWorkspaceId: string } };
      assert.ok(body.cascadeRule);
      assert.equal(body.cascadeRule!.basis, 'topology');
      assert.equal(body.cascadeRule!.sourceWorkspaceId, 'ws-web');
      assert.equal(body.cascadeRule!.targetWorkspaceId, 'ws-api');

      const rulesRes = await fetch(`${baseUrl}/cascade-rules`, { headers: authHeaders(ORG_A_KEY) });
      const rules = (await rulesRes.json() as { rules: unknown[] }).rules;
      assert.equal(rules.length, 1);
    });
  });

  it('does not derive a cascade rule for non-depends_on or non-workspace edges', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/topology/edges`, {
        method: 'POST',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ fromType: 'workspace', fromId: 'ws-web', toType: 'repository', toId: 'repo-1', edgeType: 'contains' }),
      });
      const body = await res.json() as { cascadeRule?: unknown };
      assert.equal(body.cascadeRule, undefined);

      const rulesRes = await fetch(`${baseUrl}/cascade-rules`, { headers: authHeaders(ORG_A_KEY) });
      assert.equal((await rulesRes.json() as { rules: unknown[] }).rules.length, 0);
    });
  });

  it('deleting the topology edge deletes its derived cascade rule but not manual ones', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const edgeRes = await fetch(`${baseUrl}/topology/edges`, {
        method: 'POST',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ fromType: 'workspace', fromId: 'ws-web', toType: 'workspace', toId: 'ws-api', edgeType: 'depends_on' }),
      });
      const edgeId = (await edgeRes.json() as { edge: { id: string } }).edge.id;

      await fetch(`${baseUrl}/cascade-rules`, {
        method: 'POST',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ sourceWorkspaceId: 'ws-mobile', targetWorkspaceId: 'ws-api', trigger: 'captain.run.promoted' }),
      });

      const deleteRes = await fetch(`${baseUrl}/topology/edges/${edgeId}`, { method: 'DELETE', headers: authHeaders(ORG_A_KEY) });
      assert.equal(deleteRes.status, 200);
      assert.equal((await deleteRes.json() as { deletedCascadeRules: number }).deletedCascadeRules, 1);

      const rulesRes = await fetch(`${baseUrl}/cascade-rules`, { headers: authHeaders(ORG_A_KEY) });
      const rules = (await rulesRes.json() as { rules: Array<{ basis: string }> }).rules;
      assert.equal(rules.length, 1);
      assert.equal(rules[0]!.basis, 'manual');
    });
  });

  it('rejects deleting a topology-derived cascade rule directly', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const edgeRes = await fetch(`${baseUrl}/topology/edges`, {
        method: 'POST',
        headers: authHeaders(ORG_A_KEY),
        body: JSON.stringify({ fromType: 'workspace', fromId: 'ws-web', toType: 'workspace', toId: 'ws-api', edgeType: 'depends_on' }),
      });
      const cascadeRule = (await edgeRes.json() as { cascadeRule: { id: string } }).cascadeRule;

      const res = await fetch(`${baseUrl}/cascade-rules/${cascadeRule.id}`, { method: 'DELETE', headers: authHeaders(ORG_A_KEY) });
      assert.equal(res.status, 400);
    });
  });
});

// ── Org isolation on topology/services ──────────────────────────────────────────

test('topology services are org-scoped', () =>
  withRunningCloudServer(makeStore(), async baseUrl => {
    await fetch(`${baseUrl}/topology/services`, {
      method: 'POST',
      headers: authHeaders(ORG_A_KEY),
      body: JSON.stringify({ name: 'payments', serviceType: 'api' }),
    });
    await fetch(`${baseUrl}/topology/services`, {
      method: 'POST',
      headers: authHeaders(ORG_B_KEY),
      body: JSON.stringify({ name: 'billing', serviceType: 'api' }),
    });

    const resA = await fetch(`${baseUrl}/topology/services`, { headers: authHeaders(ORG_A_KEY) });
    const servicesA = (await resA.json() as { services: Array<{ name: string }> }).services;
    assert.equal(servicesA.length, 1);
    assert.equal(servicesA[0]!.name, 'payments');
  }));
