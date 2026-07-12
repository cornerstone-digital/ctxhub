import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createCloudServer, createInMemoryStore, type CloudStore } from './service.js';

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

function fakeArchiveBase64(content = 'fake archive bytes'): string {
  return Buffer.from(content).toString('base64');
}

describe('POST /blueprints', () => {
  it('publishes a blueprint and returns the record', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/blueprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({
          name: 'fintech-compliance', version: '1.0.0', description: 'Compliance blueprint',
          archiveBase64: fakeArchiveBase64(),
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as { blueprint: { name: string; orgId: string | null } };
      assert.equal(body.blueprint.name, 'fintech-compliance');
      assert.equal(body.blueprint.orgId, ORG_A_ID); // private by default
    });
  });

  it('publishes as public when public:true is set', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/blueprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({
          name: 'public-bp', version: '1.0.0', description: 'A public one', public: true,
          archiveBase64: fakeArchiveBase64(),
        }),
      });
      const body = await res.json() as { blueprint: { orgId: string | null } };
      assert.equal(body.blueprint.orgId, null);
    });
  });

  it('rejects publishing the same name@version twice', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const payload = JSON.stringify({
        name: 'dup-bp', version: '1.0.0', description: 'desc', archiveBase64: fakeArchiveBase64(),
      });
      const first = await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` }, body: payload,
      });
      assert.equal(first.status, 201);

      const second = await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` }, body: payload,
      });
      assert.equal(second.status, 409);
    });
  });

  it('returns 401 without an API key', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      const res = await fetch(`${baseUrl}/blueprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', version: '1.0.0', description: 'x', archiveBase64: fakeArchiveBase64() }),
      });
      assert.equal(res.status, 401);
    });
  });
});

describe('GET /blueprints', () => {
  it('lists public blueprints for every org, and org-private ones only for their own org', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({ name: 'a-private', version: '1.0.0', description: 'private to org A', archiveBase64: fakeArchiveBase64() }),
      });
      await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({ name: 'shared-public', version: '1.0.0', description: 'public', public: true, archiveBase64: fakeArchiveBase64() }),
      });

      const orgAList = await (await fetch(`${baseUrl}/blueprints`, { headers: { Authorization: `Bearer ${ORG_A_KEY}` } })).json() as { blueprints: Array<{ name: string }> };
      assert.deepEqual(orgAList.blueprints.map(b => b.name).sort(), ['a-private', 'shared-public']);

      const orgBList = await (await fetch(`${baseUrl}/blueprints`, { headers: { Authorization: `Bearer ${ORG_B_KEY}` } })).json() as { blueprints: Array<{ name: string }> };
      assert.deepEqual(orgBList.blueprints.map(b => b.name), ['shared-public']); // org A's private one is NOT visible
    });
  });

  it('filters by ?q= across name, description, and tags', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({ name: 'fintech-compliance', version: '1.0.0', description: 'Regulatory review', tags: ['finance'], public: true, archiveBase64: fakeArchiveBase64() }),
      });
      await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({ name: 'frontend-review', version: '1.0.0', description: 'React patterns', public: true, archiveBase64: fakeArchiveBase64() }),
      });

      const res = await fetch(`${baseUrl}/blueprints?q=finance`, { headers: { Authorization: `Bearer ${ORG_A_KEY}` } });
      const body = await res.json() as { blueprints: Array<{ name: string }> };
      assert.deepEqual(body.blueprints.map(b => b.name), ['fintech-compliance']);
    });
  });
});

describe('GET /blueprints/:name/:version and .../download', () => {
  it('returns 404 for an org-private blueprint requested by a different org', async () => {
    const store = makeStore();
    await withRunningCloudServer(store, async baseUrl => {
      await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({ name: 'a-secret', version: '1.0.0', description: 'secret', archiveBase64: fakeArchiveBase64() }),
      });

      const asOrgB = await fetch(`${baseUrl}/blueprints/a-secret/1.0.0`, { headers: { Authorization: `Bearer ${ORG_B_KEY}` } });
      assert.equal(asOrgB.status, 404);

      const asOrgA = await fetch(`${baseUrl}/blueprints/a-secret/1.0.0`, { headers: { Authorization: `Bearer ${ORG_A_KEY}` } });
      assert.equal(asOrgA.status, 200);
    });
  });

  it('download returns the exact archive bytes published, verified by hash', async () => {
    const store = makeStore();
    const content = 'a very real tarball, i promise';
    await withRunningCloudServer(store, async baseUrl => {
      await fetch(`${baseUrl}/blueprints`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
        body: JSON.stringify({ name: 'roundtrip-bp', version: '1.0.0', description: 'x', public: true, archiveBase64: fakeArchiveBase64(content) }),
      });

      const res = await fetch(`${baseUrl}/blueprints/roundtrip-bp/1.0.0/download`, { headers: { Authorization: `Bearer ${ORG_A_KEY}` } });
      assert.equal(res.status, 200);
      const body = await res.json() as { archiveBase64: string; archiveHash: string };
      const downloaded = Buffer.from(body.archiveBase64, 'base64');
      assert.equal(downloaded.toString(), content);
      assert.equal(body.archiveHash, createHash('sha256').update(downloaded).digest('hex'));
    });
  });
});

test('publish, list, get, and download work end to end for a public blueprint', async () => {
  const store = makeStore();
  await withRunningCloudServer(store, async baseUrl => {
    const publishRes = await fetch(`${baseUrl}/blueprints`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ORG_A_KEY}` },
      body: JSON.stringify({ name: 'e2e-bp', version: '2.1.0', description: 'end to end', author: 'alice', public: true, archiveBase64: fakeArchiveBase64('e2e content') }),
    });
    assert.equal(publishRes.status, 201);

    const listRes = await fetch(`${baseUrl}/blueprints`, { headers: { Authorization: `Bearer ${ORG_B_KEY}` } });
    const list = await listRes.json() as { blueprints: Array<{ name: string; version: string; author?: string }> };
    assert.ok(list.blueprints.some(b => b.name === 'e2e-bp' && b.version === '2.1.0' && b.author === 'alice'));

    const getRes = await fetch(`${baseUrl}/blueprints/e2e-bp/2.1.0`, { headers: { Authorization: `Bearer ${ORG_B_KEY}` } });
    assert.equal(getRes.status, 200);

    const downloadRes = await fetch(`${baseUrl}/blueprints/e2e-bp/2.1.0/download`, { headers: { Authorization: `Bearer ${ORG_B_KEY}` } });
    const downloadBody = await downloadRes.json() as { archiveBase64: string };
    assert.equal(Buffer.from(downloadBody.archiveBase64, 'base64').toString(), 'e2e content');
  });
});
