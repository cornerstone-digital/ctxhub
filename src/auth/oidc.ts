import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import type { OidcConfig, OidcDiscovery, EntraTokenResponse } from './types.js';

// Cache discovery documents in-process — Entra ID rarely changes these
const discoveryCache = new Map<string, OidcDiscovery>();

/**
 * Discover the OIDC configuration for the given provider config.
 *
 * - Entra (or legacy configs with tenantId and no provider): uses Entra discovery URL.
 * - okta/google/generic: uses `${issuerUrl}/.well-known/openid-configuration`.
 *
 * The string key parameter is kept for backward compatibility; the full OidcConfig
 * overload is the preferred form for new callers.
 */
export async function discoverOidc(tenantIdOrConfig: string | OidcConfig): Promise<OidcDiscovery> {
  let discoveryUrl: string;
  let cacheKey: string;

  if (typeof tenantIdOrConfig === 'string') {
    // Legacy call: discoverOidc(tenantId)
    const tenantId = tenantIdOrConfig;
    cacheKey = `entra:${tenantId}`;
    discoveryUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
  } else {
    const cfg = tenantIdOrConfig;
    const provider = cfg.provider ?? (cfg.tenantId ? 'entra' : 'generic');

    if (provider === 'entra') {
      if (!cfg.tenantId) throw new Error('tenantId is required for Entra ID provider');
      cacheKey = `entra:${cfg.tenantId}`;
      discoveryUrl = `https://login.microsoftonline.com/${cfg.tenantId}/v2.0/.well-known/openid-configuration`;
    } else {
      if (!cfg.issuerUrl) throw new Error(`issuerUrl is required for provider "${provider}"`);
      cacheKey = `generic:${cfg.issuerUrl}`;
      discoveryUrl = `${cfg.issuerUrl}/.well-known/openid-configuration`;
    }
  }

  if (discoveryCache.has(cacheKey)) return discoveryCache.get(cacheKey)!;

  const res = await fetch(discoveryUrl);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}): ${res.statusText}`);
  }

  const doc = (await res.json()) as OidcDiscovery;
  discoveryCache.set(cacheKey, doc);
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
