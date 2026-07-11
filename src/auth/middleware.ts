import type http from 'node:http';
import { verifyAccessToken, principalFromClaims } from './jwt.js';
import { loadAuthConfig, isAuthConfigured } from './config.js';
import { loadMachineTokenStore, verifyToken, saveMachineTokenStore } from './machineTokenStore.js';
import { eventBus } from '../events/eventBus.js';
import type { Principal } from './types.js';

// Augment IncomingMessage so handlers can read req.principal after auth
declare module 'node:http' {
  interface IncomingMessage {
    principal?: Principal;
  }
}

// Paths that never require auth — even when auth is fully configured.
// /auth/* covers the login initiation and callback routes.
// /health lets monitoring check liveness without a token.
// /assets/* serves the UI bundle.
const PUBLIC_PREFIXES = ['/auth/', '/assets/'];
const PUBLIC_EXACT = new Set(['/health', '/']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

export type AuthOutcome =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401; code: string; hint: string };

async function authenticateMachineToken(
  rawToken: string,
  req: http.IncomingMessage,
  path: string,
  method: string,
): Promise<AuthOutcome> {
  const store = await loadMachineTokenStore();
  const now = new Date();

  for (const mt of store.tokens) {
    // Skip revoked tokens
    if (mt.revokedAt) continue;
    // Skip expired tokens
    if (new Date(mt.expiresAt) < now) continue;

    const matches = await verifyToken(rawToken, mt.hashedToken);
    if (matches) {
      // Update lastUsedAt — best-effort, fire-and-forget
      mt.lastUsedAt = now.toISOString();
      void saveMachineTokenStore(store).catch(() => { /* best-effort */ });

      const principal: Principal = {
        sub: `machine:${mt.id}`,
        email: '',
        name: mt.name,
        roles: mt.roles,
      };
      req.principal = principal;
      return { ok: true, principal };
    }
  }

  try { eventBus.publish({ type: 'auth.unauthorized', path, method, reason: 'invalid_token' }); } catch { /* audit failure must not block request */ }
  return {
    ok: false,
    status: 401,
    code: 'invalid_token',
    hint: 'Invalid or expired machine token',
  };
}

/**
 * Authenticate a request against the ctxhub JWT.
 *
 * Local mode (no auth configured): every caller is treated as owner.
 * Configured mode: Bearer JWT required on non-public paths.
 */
export async function authenticate(
  req: http.IncomingMessage,
  url: URL,
): Promise<AuthOutcome> {
  // Local mode — auth not configured, grant owner access to everything
  if (!(await isAuthConfigured())) {
    const local: Principal = {
      sub: 'local',
      email: 'local',
      name: 'Local',
      roles: ['owner'],
    };
    req.principal = local;
    return { ok: true, principal: local };
  }

  // Public paths are reachable without a token even in configured mode
  if (isPublicPath(url.pathname)) {
    return {
      ok: true,
      principal: { sub: 'anonymous', email: '', name: '', roles: [] },
    };
  }

  const path = url.pathname;
  const method = req.method ?? 'UNKNOWN';

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    try { eventBus.publish({ type: 'auth.unauthorized', path, method, reason: 'missing_token' }); } catch { /* audit failure must not block request */ }
    return {
      ok: false,
      status: 401,
      code: 'missing_token',
      hint: 'Run: ctxhub login',
    };
  }

  const token = authHeader.slice(7);

  // Machine token path: Bearer ctxm_<hex>
  if (token.startsWith('ctxm_')) {
    return authenticateMachineToken(token, req, path, method);
  }

  const config = await loadAuthConfig();
  if (!config) {
    try { eventBus.publish({ type: 'auth.unauthorized', path, method, reason: 'auth_not_configured' }); } catch { /* audit failure must not block request */ }
    return {
      ok: false,
      status: 401,
      code: 'auth_not_configured',
      hint: 'Run: ctxhub auth configure',
    };
  }

  try {
    const claims = verifyAccessToken(token, config.jwtSecret);
    const principal = principalFromClaims(claims);
    req.principal = principal;
    return { ok: true, principal };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const code = msg.includes('expired') ? 'token_expired' : 'invalid_token';
    try { eventBus.publish({ type: 'auth.unauthorized', path, method, reason: code }); } catch { /* audit failure must not block request */ }
    return {
      ok: false,
      status: 401,
      code,
      hint: 'Run: ctxhub login',
    };
  }
}
