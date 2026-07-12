import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createServiceServer } from './server.js';
import { initSamlAuthConfig } from '../auth/config.js';
import { generateMockIdpCert, buildSignedSamlResponse, certForConfig, type MockIdpKeyPair } from '../auth/samlMockIdp.js';
import type { SamlConfig } from '../auth/types.js';

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

// eventBus.publish() is deliberately fire-and-forget (best-effort audit logging, see
// eventBus.ts) -- a login_failed event's write can still be in flight when cleanup runs.
// Not a product bug (nothing here needs the write to complete before responding), just a
// test-teardown race; retry once rather than widen eventBus's real contract.
async function rmWithRetry(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw err;
    await new Promise(resolve => setTimeout(resolve, 50));
    await rm(dir, { recursive: true, force: true });
  }
}

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-saml-routes-home-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = ctxhubHome;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rmWithRetry(ctxhubHome);
  }
}

const IDP_ISSUER = 'https://mock-idp.example.com/metadata';
const SP_ENTITY_ID = 'https://ctxhub.example.com/saml/metadata';

let idp: MockIdpKeyPair;
test.before(async () => { idp = await generateMockIdpCert(); });

async function configureSaml(callbackUrl: string): Promise<SamlConfig> {
  const config: SamlConfig = {
    idpEntryPoint: 'https://mock-idp.example.com/sso',
    idpIssuer: IDP_ISSUER,
    idpCert: certForConfig(idp.cert),
    spEntityId: SP_ENTITY_ID,
    callbackUrl,
  };
  await initSamlAuthConfig(config);
  return config;
}

test('GET /auth/saml/metadata returns 404 when SAML is not configured', () =>
  withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/auth/saml/metadata`);
      assert.equal(res.status, 404);
    })
  ));

test('GET /auth/saml/metadata returns SP metadata XML naming this entity ID', () =>
  withIsolatedCtxhubHome(async () => {
    await configureSaml('http://localhost/auth/saml/acs');
    await withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/auth/saml/metadata`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/xml');
      const xml = await res.text();
      assert.ok(xml.includes(SP_ENTITY_ID));
    });
  }));

test('GET /auth/saml/login redirects to the configured IdP entry point', () =>
  withIsolatedCtxhubHome(async () => {
    await configureSaml('http://localhost/auth/saml/acs');
    await withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/auth/saml/login`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      const location = res.headers.get('location') ?? '';
      assert.ok(location.startsWith('https://mock-idp.example.com/sso'));
    });
  }));

test('POST /auth/saml/acs validates a real signed response and returns a usable Bearer token', () =>
  withIsolatedCtxhubHome(async () => {
    await withRunningServer(async baseUrl => {
      const config = await configureSaml(`${baseUrl}/auth/saml/acs`);
      const samlResponse = await buildSignedSamlResponse(idp, {
        idpIssuer: IDP_ISSUER,
        spEntityId: SP_ENTITY_ID,
        acsUrl: config.callbackUrl,
        email: 'alice@example.com',
        name: 'Alice Example',
        groups: ['engineering'],
      });

      const acsRes = await fetch(`${baseUrl}/auth/saml/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: samlResponse }),
      });
      assert.equal(acsRes.status, 200);
      const html = await acsRes.text();
      assert.ok(html.includes('Signed in via SAML'));
      assert.ok(html.includes('alice@example.com'));

      const tokenMatch = html.match(/<textarea[^>]*>([^<]+)<\/textarea>/);
      assert.ok(tokenMatch, 'response page should contain the issued JWT');
      const token = tokenMatch![1];

      // Prove it's a real, usable Bearer credential -- 401 without it, 200 with it.
      const withoutToken = await fetch(`${baseUrl}/workspaces`);
      assert.equal(withoutToken.status, 401);

      const withToken = await fetch(`${baseUrl}/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(withToken.status, 200);
    });
  }));

test('POST /auth/saml/acs rejects a response signed by an untrusted key', () =>
  withIsolatedCtxhubHome(async () => {
    await withRunningServer(async baseUrl => {
      const config = await configureSaml(`${baseUrl}/auth/saml/acs`);
      const otherIdp = await generateMockIdpCert();
      const samlResponse = await buildSignedSamlResponse(otherIdp, {
        idpIssuer: IDP_ISSUER,
        spEntityId: SP_ENTITY_ID,
        acsUrl: config.callbackUrl,
        email: 'attacker@evil.example.com',
      });

      const res = await fetch(`${baseUrl}/auth/saml/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: samlResponse }),
      });
      assert.equal(res.status, 400);
      const html = await res.text();
      assert.ok(html.includes('SAML sign-in failed'));
    });
  }));

test('POST /auth/saml/acs returns 400 with no SAMLResponse in the body', () =>
  withIsolatedCtxhubHome(async () => {
    await configureSaml('http://localhost/auth/saml/acs');
    await withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/auth/saml/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({}),
      });
      assert.equal(res.status, 400);
    });
  }));
