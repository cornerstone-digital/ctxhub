/**
 * Test-only mock SAML IdP. Generates a real self-signed cert and real, correctly-signed
 * SAML Response XML so src/auth/saml.ts's SP-side validation (backed by @node-saml/node-saml)
 * can be tested against actual signature verification, not a stub that always says "valid".
 *
 * Not used anywhere outside tests. Deliberately hand-rolled with xml-crypto + xmlbuilder
 * rather than pulling in an existing "fake IdP" package (samlp) -- that package pins an old
 * xml-crypto/xmldom major version with known CVEs this project just fixed (see the security
 * fix earlier in this history), and drags in Express-middleware-shaped dependencies for a
 * shape this project doesn't need.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SignedXml } from 'xml-crypto';

const execFileAsync = promisify(execFile);

export interface MockIdpKeyPair {
  cert: string; // PEM, with BEGIN/END lines
  key: string;  // PEM, with BEGIN/END lines
}

/** Generates a real self-signed RSA 2048 / SHA-256 cert via openssl -- there's no pure-JS
 * X.509 cert generation in Node's built-in crypto, only key pairs. */
export async function generateMockIdpCert(): Promise<MockIdpKeyPair> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-saml-mock-idp-'));
  try {
    const keyPath = path.join(dir, 'key.pem');
    const certPath = path.join(dir, 'cert.pem');
    await execFileAsync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-nodes', '-subj', '/CN=ctxhub-mock-idp',
    ]);
    const [cert, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
    return { cert, key };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface MockAssertionOptions {
  idpIssuer: string;
  spEntityId: string;
  acsUrl: string;
  email: string;
  name?: string;
  groups?: string[];
  /** InResponseTo -- present for SP-initiated flow continuation, absent for IdP-initiated */
  inResponseTo?: string;
  /** Signals a malformed/expired assertion for negative tests */
  notOnOrAfterOverride?: string;
}

function stripPemHeaders(pem: string): string {
  return pem.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s+/g, '');
}

/**
 * Builds a real signed SAML 2.0 Response containing one Assertion, matching what a real IdP
 * sends on successful login. Signs the Assertion (not the outer Response) with an enveloped
 * signature -- the most common real-IdP pattern (Okta, Azure AD SAML apps both do this).
 */
export async function buildSignedSamlResponse(idp: MockIdpKeyPair, opts: MockAssertionOptions): Promise<string> {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = opts.notOnOrAfterOverride ?? new Date(now.getTime() + 5 * 60_000).toISOString();
  const issueInstant = now.toISOString();

  const responseId = `_${randomUUID()}`;
  const assertionId = `_${randomUUID()}`;

  const attributeStatements = [
    `<saml:Attribute Name="email"><saml:AttributeValue>${opts.email}</saml:AttributeValue></saml:Attribute>`,
    `<saml:Attribute Name="name"><saml:AttributeValue>${opts.name ?? opts.email}</saml:AttributeValue></saml:Attribute>`,
  ];
  if (opts.groups?.length) {
    const values = opts.groups.map(g => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join('');
    attributeStatements.push(`<saml:Attribute Name="groups">${values}</saml:Attribute>`);
  }

  // Unsigned assertion XML first -- xml-crypto signs it in place below via an enveloped
  // transform, matching how a real IdP embeds <ds:Signature> as a child of <saml:Assertion>.
  const assertionXml =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${issueInstant}">` +
    `<saml:Issuer>${opts.idpIssuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData${opts.inResponseTo ? ` InResponseTo="${opts.inResponseTo}"` : ''} NotOnOrAfter="${notOnOrAfter}" Recipient="${opts.acsUrl}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${opts.spEntityId}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="${assertionId}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${attributeStatements.join('')}</saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const sig = new SignedXml({
    privateKey: idp.key,
    publicCert: idp.cert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: `//*[local-name(.)='Assertion']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(assertionXml, {
    location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' },
  });
  const signedAssertionXml = sig.getSignedXml();

  const responseXml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${opts.acsUrl}"` +
    `${opts.inResponseTo ? ` InResponseTo="${opts.inResponseTo}"` : ''}>` +
    `<saml:Issuer>${opts.idpIssuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    signedAssertionXml +
    `</samlp:Response>`;

  return Buffer.from(responseXml, 'utf8').toString('base64');
}

/** PEM cert with headers/whitespace stripped -- the format SamlConfig.idpCert expects (matches
 * how real IdP metadata XML embeds certs, and what node-saml expects for idpCert). */
export function certForConfig(pem: string): string {
  return stripPemHeaders(pem);
}
