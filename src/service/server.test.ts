import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { initConfig } from '../config/config.js';
import { registerWorkspace } from '../workspaces/registry.js';
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
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-service-server-home-'));
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

test('GET / serves the self-contained Fleet view HTML page', () => {
  return withRunningServer(async baseUrl => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /ctxhub Fleet/);
    assert.match(html, /fetch\('\/workspaces'\)/);
    assert.ok(!html.includes('cdn.'), 'the Fleet view must stay self-contained, no CDN assets');
  });
});

test('GET /health reports ok with a version string', () => {
  return withRunningServer(async baseUrl => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.version === 'string' && body.version.length > 0);
  });
});

test('GET /workspaces returns an empty list when nothing is registered', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.workspaces, []);
    })
  );
});

test('GET /workspaces lists a registered workspace, and /workspaces/:name/status reuses ctxhub doctor checks', () => {
  return withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-service-server-ws-'));
    try {
      await initConfig('server-ws', workspaceDir);
      await registerWorkspace(workspaceDir);

      await withRunningServer(async baseUrl => {
        const listRes = await fetch(`${baseUrl}/workspaces`);
        const listBody = await listRes.json();
        assert.equal(listBody.workspaces.length, 1);
        assert.equal(listBody.workspaces[0].name, 'server-ws');
        assert.equal(listBody.workspaces[0].exists, true);

        const statusRes = await fetch(`${baseUrl}/workspaces/server-ws/status`);
        assert.equal(statusRes.status, 200);
        const statusBody = await statusRes.json();
        assert.equal(statusBody.name, 'server-ws');
        assert.ok(Array.isArray(statusBody.checks) && statusBody.checks.length > 0);
        assert.ok(statusBody.checks.some((line: { message: string }) => line.message.includes('Config schema')));
      });
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

test('GET /workspaces/:name/status 404s for an unregistered name', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces/nonexistent/status`);
      assert.equal(res.status, 404);
    })
  );
});

test('unknown routes 404', () => {
  return withRunningServer(async baseUrl => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
  });
});
