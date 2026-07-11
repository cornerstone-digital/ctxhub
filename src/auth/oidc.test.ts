/**
 * Tests for OIDC discovery URL construction.
 * We test only the URL-building logic, not actual HTTP requests.
 * The discoverOidc function is tested by mocking fetch.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { discoverOidc } from './oidc.js';
import type { OidcConfig, OidcDiscovery } from './types.js';

// Minimal mock discovery document
const mockDiscovery: OidcDiscovery = {
  issuer: 'https://example.com',
  authorization_endpoint: 'https://example.com/auth',
  token_endpoint: 'https://example.com/token',
  jwks_uri: 'https://example.com/jwks',
};

describe('discoverOidc URL construction', () => {
  let originalFetch: typeof globalThis.fetch;
  let lastFetchedUrl: string;

  before(() => {
    originalFetch = globalThis.fetch;
    // Intercept fetch to capture URL and return mock response
    globalThis.fetch = async (url: string | URL | Request) => {
      lastFetchedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => mockDiscovery,
      } as Response;
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('builds correct Entra ID URL from tenantId string (legacy call)', async () => {
    const tenantId = 'my-tenant-id';
    await discoverOidc(tenantId);
    assert.equal(
      lastFetchedUrl,
      `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
    );
  });

  it('builds correct Entra ID URL from OidcConfig with provider=entra', async () => {
    const config: OidcConfig = {
      provider: 'entra',
      tenantId: 'test-tenant',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'http://localhost/callback',
    };
    await discoverOidc(config);
    assert.equal(
      lastFetchedUrl,
      `https://login.microsoftonline.com/test-tenant/v2.0/.well-known/openid-configuration`,
    );
  });

  it('uses issuerUrl for generic provider', async () => {
    const config: OidcConfig = {
      provider: 'generic',
      issuerUrl: 'https://idp.example.com/oauth2/default',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'http://localhost/callback',
    };
    await discoverOidc(config);
    assert.equal(
      lastFetchedUrl,
      'https://idp.example.com/oauth2/default/.well-known/openid-configuration',
    );
  });

  it('uses issuerUrl for okta provider', async () => {
    const config: OidcConfig = {
      provider: 'okta',
      issuerUrl: 'https://dev-123.okta.com/oauth2/default',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'http://localhost/callback',
    };
    await discoverOidc(config);
    assert.equal(
      lastFetchedUrl,
      'https://dev-123.okta.com/oauth2/default/.well-known/openid-configuration',
    );
  });

  it('uses issuerUrl for google provider', async () => {
    const config: OidcConfig = {
      provider: 'google',
      issuerUrl: 'https://accounts.google.com',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'http://localhost/callback',
    };
    await discoverOidc(config);
    assert.equal(
      lastFetchedUrl,
      'https://accounts.google.com/.well-known/openid-configuration',
    );
  });
});
