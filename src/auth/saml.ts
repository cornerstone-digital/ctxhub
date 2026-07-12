/**
 * SAML 2.0 Service Provider wrapper around @node-saml/node-saml.
 *
 * @node-saml/node-saml (the maintained fork of passport-saml's core validation logic) does
 * the actual XML signature verification, canonicalization, and assertion parsing --
 * deliberately not hand-rolled here. Getting XML-DSig verification subtly wrong is a classic
 * source of real SAML vulnerabilities (signature wrapping, XXE); using a maintained library
 * is the safer choice even though it means a real dependency for a feature that's otherwise
 * "just" auth config.
 *
 * Validated only against a local mock IdP built for this project (samlMockIdp.ts, test-only)
 * -- see SamlConfig's doc comment in types.ts.
 */
import { SAML, type Profile } from '@node-saml/node-saml';
import type { SamlConfig } from './types.js';

const DEFAULT_ATTRIBUTES = {
  email: 'email',
  name: 'name',
  groups: 'groups',
};

export function createSamlClient(config: SamlConfig): SAML {
  return new SAML({
    idpCert: config.idpCert,
    issuer: config.spEntityId,
    callbackUrl: config.callbackUrl,
    entryPoint: config.idpEntryPoint,
    wantAssertionsSigned: true,
    // node-saml defaults this to true, which requires the outer <samlp:Response> envelope
    // itself to carry a top-level signature -- but signing just the <saml:Assertion> (not
    // the envelope) is the common real-world pattern (this is how the Keycloak test client
    // this was validated against is configured, and matches Okta's default too). Requiring
    // both wastes a round trip second-guessing the actual security property that matters:
    // wantAssertionsSigned already ensures the assertion itself can't be forged or tampered.
    wantAuthnResponseSigned: false,
    identifierFormat: null,
  });
}

export async function getSamlAuthorizeUrl(config: SamlConfig, relayState = ''): Promise<string> {
  const saml = createSamlClient(config);
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

export interface SamlProfile {
  nameId: string;
  email: string;
  name: string;
  groups: string[];
  issuer: string;
  raw: Profile;
}

/**
 * Validates a POSTed SAMLResponse (works for both SP-initiated continuation and
 * IdP-initiated login -- node-saml's validatePostResponseAsync doesn't require a prior
 * AuthnRequest to have been sent, only that the response/assertion signature and issuer
 * check out).
 */
export async function validateSamlResponse(config: SamlConfig, samlResponseBase64: string): Promise<SamlProfile> {
  const saml = createSamlClient(config);
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponseBase64 });
  if (!profile) {
    throw new Error('SAML response validated but contained no profile (this should not happen for a non-logout response)');
  }
  if (profile.issuer !== config.idpIssuer) {
    throw new Error(`SAML response issuer "${profile.issuer}" does not match configured idpIssuer "${config.idpIssuer}"`);
  }

  const mapping = { ...DEFAULT_ATTRIBUTES, ...config.attributeMapping };
  const email = String(profile[mapping.email] ?? profile.email ?? profile.mail ?? '');
  const name = String(profile[mapping.name] ?? email);
  const groupsRaw = profile[mapping.groups];
  const groups = Array.isArray(groupsRaw) ? groupsRaw.map(String) : typeof groupsRaw === 'string' ? [groupsRaw] : [];

  if (!email) {
    throw new Error(`SAML assertion has no usable email attribute (looked for "${mapping.email}", "email", "mail")`);
  }

  return { nameId: profile.nameID, email, name, groups, issuer: profile.issuer, raw: profile };
}

export function generateSpMetadata(config: SamlConfig): string {
  const saml = createSamlClient(config);
  return saml.generateServiceProviderMetadata(null, null);
}
