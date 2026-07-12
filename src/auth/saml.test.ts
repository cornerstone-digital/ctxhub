import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSamlResponse, getSamlAuthorizeUrl, generateSpMetadata } from './saml.js';
import { generateMockIdpCert, buildSignedSamlResponse, certForConfig, type MockIdpKeyPair } from './samlMockIdp.js';
import type { SamlConfig } from './types.js';

const IDP_ISSUER = 'https://mock-idp.example.com/metadata';
const SP_ENTITY_ID = 'https://ctxhub.example.com/saml/metadata';
const ACS_URL = 'https://ctxhub.example.com/auth/saml/acs';

let idp: MockIdpKeyPair;
let config: SamlConfig;

test.before(async () => {
  idp = await generateMockIdpCert();
  config = {
    idpEntryPoint: 'https://mock-idp.example.com/sso',
    idpIssuer: IDP_ISSUER,
    idpCert: certForConfig(idp.cert),
    spEntityId: SP_ENTITY_ID,
    callbackUrl: ACS_URL,
  };
});

test('validates a real signed IdP-initiated SAML response and extracts attributes', async () => {
  const samlResponse = await buildSignedSamlResponse(idp, {
    idpIssuer: IDP_ISSUER,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    email: 'alice@example.com',
    name: 'Alice Example',
    groups: ['engineering', 'admins'],
    // no inResponseTo -- IdP-initiated
  });

  const profile = await validateSamlResponse(config, samlResponse);
  assert.equal(profile.email, 'alice@example.com');
  assert.equal(profile.name, 'Alice Example');
  assert.deepEqual(profile.groups, ['engineering', 'admins']);
  assert.equal(profile.issuer, IDP_ISSUER);
});

test('validates an SP-initiated response carrying InResponseTo', async () => {
  const samlResponse = await buildSignedSamlResponse(idp, {
    idpIssuer: IDP_ISSUER,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    email: 'bob@example.com',
    inResponseTo: '_some-request-id',
  });

  const profile = await validateSamlResponse(config, samlResponse);
  assert.equal(profile.email, 'bob@example.com');
});

test('rejects a response signed by a different (untrusted) IdP key pair', async () => {
  const otherIdp = await generateMockIdpCert();
  const samlResponse = await buildSignedSamlResponse(otherIdp, {
    idpIssuer: IDP_ISSUER,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    email: 'attacker@evil.example.com',
  });

  await assert.rejects(() => validateSamlResponse(config, samlResponse));
});

test('rejects a response with a mismatched issuer', async () => {
  const samlResponse = await buildSignedSamlResponse(idp, {
    idpIssuer: 'https://not-the-configured-idp.example.com',
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    email: 'alice@example.com',
  });

  await assert.rejects(() => validateSamlResponse(config, samlResponse), /issuer/i);
});

test('rejects an expired assertion', async () => {
  const samlResponse = await buildSignedSamlResponse(idp, {
    idpIssuer: IDP_ISSUER,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    email: 'alice@example.com',
    notOnOrAfterOverride: new Date(Date.now() - 60_000).toISOString(), // already expired
  });

  await assert.rejects(() => validateSamlResponse(config, samlResponse));
});

test('rejects a tampered assertion (email changed after signing)', async () => {
  const samlResponse = await buildSignedSamlResponse(idp, {
    idpIssuer: IDP_ISSUER,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    email: 'alice@example.com',
  });

  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  const tampered = xml.replace('alice@example.com', 'attacker@evil.example.com');
  const tamperedResponse = Buffer.from(tampered, 'utf8').toString('base64');

  await assert.rejects(() => validateSamlResponse(config, tamperedResponse));
});

test('getSamlAuthorizeUrl produces a redirect to the configured IdP entry point', async () => {
  const url = await getSamlAuthorizeUrl(config);
  assert.ok(url.startsWith(config.idpEntryPoint));
  assert.ok(url.includes('SAMLRequest='));
});

test('generateSpMetadata produces XML naming this SP\'s entity ID and ACS URL', () => {
  const xml = generateSpMetadata(config);
  assert.ok(xml.includes(SP_ENTITY_ID));
  assert.ok(xml.includes(ACS_URL));
});
