import { test, expect } from '@playwright/test';

/**
 * Real-IdP SAML integration test against Keycloak, not a hand-rolled mock. Skipped unless
 * Keycloak is reachable at localhost:8080 (docker-compose.keycloak.yml) -- this is
 * deliberately not part of the default e2e run.
 *
 * Usage:
 *   docker compose -f ../docker-compose.keycloak.yml up -d
 *   npx playwright test e2e/saml-keycloak.spec.ts
 *
 * Sets up a realm/client/user/group via Keycloak's own Admin REST API (the same thing a real
 * customer's IdP admin would configure by hand), then drives an actual browser through
 * Keycloak's real login form and validates the real signed SAMLResponse it returns --
 * catches exactly the kind of interop bug (wantAuthnResponseSigned defaulting to true in
 * node-saml, which a hand-rolled mock IdP that signs its own responses correctly would never
 * surface, since it's about what real IdPs choose to sign, not raw XML-DSig correctness).
 */

const KEYCLOAK_URL = 'http://localhost:8080';
const REALM = 'ctxhub-saml-e2e';
const SP_ENTITY_ID = 'https://ctxhub.example.com/saml/metadata';
const ACS_URL = 'https://ctxhub.example.com/auth/saml/acs';

const ROOT = '/Users/martinegan/development/personal/ctxhub';

async function keycloakReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${KEYCLOAK_URL}/realms/master/.well-known/openid-configuration`);
    return res.ok;
  } catch {
    return false;
  }
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&client_id=admin-cli&username=admin&password=admin',
  });
  const body = await res.json() as { access_token: string };
  return body.access_token;
}

async function kcAdmin(token: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`${KEYCLOAK_URL}/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

test.describe('SAML against a real Keycloak IdP', () => {
  test.beforeAll(async () => {
    if (!(await keycloakReachable())) {
      test.skip(true, 'Keycloak not reachable at localhost:8080 -- start docker-compose.keycloak.yml to run this');
    }

    const token = await getAdminToken();

    // Realm may already exist from a previous run -- ignore 409.
    await kcAdmin(token, '/realms', 'POST', { realm: REALM, enabled: true });

    await kcAdmin(token, `/realms/${REALM}/clients`, 'POST', {
      clientId: SP_ENTITY_ID,
      protocol: 'saml',
      enabled: true,
      redirectUris: [ACS_URL],
      attributes: {
        'saml.assertion.signature': 'true',
        'saml.server.signature': 'false',
        'saml.client.signature': 'false',
        'saml.signature.algorithm': 'RSA_SHA256',
        saml_name_id_format: 'email',
        'saml.authnstatement': 'true',
      },
    });

    const clientsRes = await kcAdmin(token, `/realms/${REALM}/clients?clientId=${encodeURIComponent(SP_ENTITY_ID)}`, 'GET');
    const clients = await clientsRes.json() as Array<{ id: string }>;
    const clientUuid = clients[0].id;

    for (const [name, mapper, config] of [
      ['email', 'saml-user-property-mapper', { 'user.attribute': 'email', 'attribute.name': 'email', 'friendly.name': 'email' }],
      ['name', 'saml-user-property-mapper', { 'user.attribute': 'firstName', 'attribute.name': 'name', 'friendly.name': 'name' }],
      ['groups', 'saml-group-membership-mapper', { 'attribute.name': 'groups', 'friendly.name': 'groups', 'full.path': 'false' }],
    ] as const) {
      await kcAdmin(token, `/realms/${REALM}/clients/${clientUuid}/protocol-mappers/models`, 'POST', {
        name, protocol: 'saml', protocolMapper: mapper, config,
      });
    }

    await kcAdmin(token, `/realms/${REALM}/groups`, 'POST', { name: 'engineering' });
    await kcAdmin(token, `/realms/${REALM}/users`, 'POST', {
      username: 'alice', email: 'alice@example.com', firstName: 'Alice', lastName: 'Example',
      enabled: true, emailVerified: true, requiredActions: [],
      credentials: [{ type: 'password', value: 'alice-test-password', temporary: false }],
    });

    const usersRes = await kcAdmin(token, `/realms/${REALM}/users?username=alice`, 'GET');
    const users = await usersRes.json() as Array<{ id: string }>;
    const groupsRes = await kcAdmin(token, `/realms/${REALM}/groups?search=engineering`, 'GET');
    const groups = await groupsRes.json() as Array<{ id: string }>;
    await kcAdmin(token, `/realms/${REALM}/users/${users[0].id}/groups/${groups[0].id}`, 'PUT');
  });

  test('SP-initiated login through a real Keycloak IdP validates and extracts real attributes', async ({ page }) => {
    const { getSamlAuthorizeUrl, validateSamlResponse } = await import(`${ROOT}/dist/auth/saml.js`);

    const descriptorRes = await fetch(`${KEYCLOAK_URL}/realms/${REALM}/protocol/saml/descriptor`);
    const descriptorXml = await descriptorRes.text();
    const cert = descriptorXml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/)?.[1];
    const sso = descriptorXml.match(/SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="([^"]+)"/)?.[1];
    expect(cert).toBeTruthy();
    expect(sso).toBeTruthy();

    const config = {
      idpEntryPoint: sso!,
      idpIssuer: `${KEYCLOAK_URL}/realms/${REALM}`,
      idpCert: cert!,
      spEntityId: SP_ENTITY_ID,
      callbackUrl: ACS_URL,
    };

    const authorizeUrl = await getSamlAuthorizeUrl(config);

    let capturedSamlResponse: string | null = null;
    await page.route(ACS_URL, async route => {
      const params = new URLSearchParams(route.request().postData() ?? '');
      capturedSamlResponse = params.get('SAMLResponse');
      await route.fulfill({ status: 200, body: 'captured' });
    });

    await page.goto(authorizeUrl);
    await page.fill('#username', 'alice');
    await page.fill('#password', 'alice-test-password');
    await page.click('#kc-login');
    await page.waitForTimeout(1500);

    expect(capturedSamlResponse).toBeTruthy();

    const profile = await validateSamlResponse(config, capturedSamlResponse!);
    expect(profile.email).toBe('alice@example.com');
    expect(profile.name).toBe('Alice');
    expect(profile.groups).toContain('engineering');
  });
});
