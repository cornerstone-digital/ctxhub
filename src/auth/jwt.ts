import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Principal, CtxhubJwtPayload } from './types.js';

// ctxhub issues its own short-lived JWTs after a successful Entra ID exchange.
// These carry ctxhub-specific claims (roles) and are signed with a symmetric key
// stored in ~/.ctxhub/auth.json — not with Entra ID's keys.
//
// Algorithm: HS256 (HMAC-SHA256). Simple, sufficient for a single-server deployment.
// EF-2 can migrate to RS256 if needed for multi-server setups.

const ISSUER = 'ctxhub';
const ACCESS_TOKEN_TTL_S = 3600;      // 1 hour

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(headerDotPayload: string, secret: Buffer): string {
  return base64url(createHmac('sha256', secret).update(headerDotPayload).digest());
}

export function issueAccessToken(
  principal: Principal,
  jwtSecret: string,
): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL_S;
  const secret = Buffer.from(jwtSecret, 'hex');

  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims: CtxhubJwtPayload = {
    sub: principal.sub,
    email: principal.email,
    name: principal.name,
    roles: principal.roles,
    iss: ISSUER,
    iat: now,
    exp,
    ...(principal.tenantId !== undefined && { tenantId: principal.tenantId }),
  };
  const payload = base64url(Buffer.from(JSON.stringify(claims)));
  const signature = sign(`${header}.${payload}`, secret);

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyAccessToken(token: string, jwtSecret: string): CtxhubJwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [header, payload, signature] = parts as [string, string, string];
  const secret = Buffer.from(jwtSecret, 'hex');
  const expected = sign(`${header}.${payload}`, secret);

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new Error('Invalid token signature');
  }

  const claims = JSON.parse(base64urlDecode(payload).toString('utf-8')) as CtxhubJwtPayload;
  const now = Math.floor(Date.now() / 1000);

  if (claims.exp < now) throw new Error('Token expired');
  if (claims.iss !== ISSUER) throw new Error('Invalid token issuer');

  return claims;
}

export function principalFromClaims(claims: CtxhubJwtPayload): Principal {
  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    roles: claims.roles,
    ...(claims.tenantId !== undefined && { tenantId: claims.tenantId }),
  };
}

export function hasRole(principal: Principal, role: string): boolean {
  // owner implicitly has all roles
  if (principal.roles.includes('owner')) return true;
  return principal.roles.includes(role);
}
