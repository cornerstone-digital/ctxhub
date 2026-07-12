import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createServiceServer } from './server.js';

async function withRunningServer(run: (baseUrl: string) => Promise<void>) {
  const server = createServiceServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-billing-routes-home-'));
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

test('GET /billing/usage returns a seats+activity report in local mode (owner by default)', () =>
  withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/billing/usage`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(typeof body.seats.scimActiveUsers === 'number');
      assert.ok(typeof body.activity.workspaceCount === 'number');
      assert.ok(typeof body.activity.eventsByCategory === 'object');
    })
  ));

test('GET /billing/usage respects a ?since= override', () =>
  withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const since = new Date('2020-01-01T00:00:00Z').toISOString();
      const res = await fetch(`${baseUrl}/billing/usage?since=${encodeURIComponent(since)}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.activity.since, since);
    })
  ));
