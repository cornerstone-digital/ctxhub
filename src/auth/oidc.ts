import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import type { OidcConfig, OidcDiscovery, EntraTokenResponse } from './types.js';

// Cache discovery documents in-process — Entra ID rarely changes these
const discoveryCache = new Map<string, OidcDiscovery>();

export async function discoverOidc(tenantId: string): Promise<OidcDiscovery> {
  if (discoveryCache.has(tenantId)) return discoveryCache.get(tenantId)!;

  const url = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}): ${res.statusText}`);
  }

  const doc = (await res.json()) as OidcDiscovery;
  discoveryCache.set(tenantId, doc);
  return doc;
}

export function buildAuthUrl(
  discovery: OidcDiscovery,
  config: OidcConfig,
  challenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    response_mode: 'query',
  });
  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  discovery: OidcDiscovery,
  config: OidcConfig,
  code: string,
  verifier: string,
): Promise<EntraTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const desc = String(err['error_description'] ?? err['error'] ?? res.statusText);
    throw new Error(`Token exchange failed: ${desc}`);
  }

  return res.json() as Promise<EntraTokenResponse>;
}

export async function refreshEntraTokens(
  discovery: OidcDiscovery,
  config: OidcConfig,
  refreshToken: string,
): Promise<EntraTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'openid profile email offline_access',
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const desc = String(err['error_description'] ?? err['error'] ?? res.statusText);
    throw new Error(`Token refresh failed: ${desc}`);
  }

  return res.json() as Promise<EntraTokenResponse>;
}

/**
 * Validate an Entra ID ID token using JWKS signature verification.
 * Uses jose's createRemoteJWKSet which caches and auto-rotates keys.
 */
export async function validateIdToken(
  idToken: string,
  discovery: OidcDiscovery,
  config: OidcConfig,
): Promise<JWTPayload> {
  const JWKS = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: discovery.issuer,
    audience: config.clientId,
  });
  return payload;
}
