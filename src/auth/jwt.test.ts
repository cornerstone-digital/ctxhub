import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { issueAccessToken, verifyAccessToken, principalFromClaims, hasRole } from './jwt.js';
import type { Principal } from './types.js';

function makeSecret(): string {
  return randomBytes(32).toString('hex');
}

const testPrincipal: Principal = {
  sub: 'aad-object-id-123',
  email: 'engineer@vodafone.com',
  name: 'Test Engineer',
  roles: ['member'],
  tenantId: 'tenant-abc-123',
};

describe('issueAccessToken', () => {
  it('returns a three-part JWT', () => {
    const secret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    assert.equal(token.split('.').length, 3);
  });

  it('sets expiresAt ~1 hour from now', () => {
    const secret = makeSecret();
    const { expiresAt } = issueAccessToken(testPrincipal, secret);
    const diff = new Date(expiresAt).getTime() - Date.now();
    assert.ok(diff > 3500 * 1000, 'expires too soon');
    assert.ok(diff < 3700 * 1000, 'expires too late');
  });
});

describe('verifyAccessToken', () => {
  it('round-trips a valid token', () => {
    const secret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    const claims = verifyAccessToken(token, secret);
    assert.equal(claims.sub, testPrincipal.sub);
    assert.equal(claims.email, testPrincipal.email);
    assert.deepEqual(claims.roles, testPrincipal.roles);
    assert.equal(claims.iss, 'ctxhub');
  });

  it('round-trips tenantId through issue/verify', () => {
    const secret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    const claims = verifyAccessToken(token, secret);
    assert.equal(claims.tenantId, testPrincipal.tenantId);
    const principal = principalFromClaims(claims);
    assert.equal(principal.tenantId, testPrincipal.tenantId);
  });

  it('omits tenantId from claims when not set', () => {
    const secret = makeSecret();
    const principalNoTenant: Principal = { sub: 'x', email: 'x@x.com', name: 'X', roles: ['member'] };
    const { token } = issueAccessToken(principalNoTenant, secret);
    const claims = verifyAccessToken(token, secret);
    assert.equal(claims.tenantId, undefined);
  });

  it('rejects a token with a wrong secret', () => {
    const secret = makeSecret();
    const wrongSecret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    assert.throws(() => verifyAccessToken(token, wrongSecret), /signature/i);
  });

  it('rejects a tampered payload', () => {
    const secret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    const parts = token.split('.');
    // Tamper the payload
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', roles: ['owner'] })).toString('base64url');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    assert.throws(() => verifyAccessToken(tampered, secret), /signature/i);
  });

  it('rejects an expired token', () => {
    const secret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    const parts = token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    claims.exp = Math.floor(Date.now() / 1000) - 1; // already expired
    const newPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    // Re-sign with the correct secret so only the expiry triggers the rejection
    const sig = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`${parts[0]}.${newPayload}`)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const expiredToken = `${parts[0]}.${newPayload}.${sig}`;
    assert.throws(() => verifyAccessToken(expiredToken, secret), /expired/i);
  });
});

describe('hasRole', () => {
  it('owner has all roles', () => {
    const owner: Principal = { ...testPrincipal, roles: ['owner'] };
    assert.ok(hasRole(owner, 'admin'));
    assert.ok(hasRole(owner, 'member'));
    assert.ok(hasRole(owner, 'reader'));
    assert.ok(hasRole(owner, 'machine'));
  });

  it('member does not have admin', () => {
    assert.ok(!hasRole(testPrincipal, 'admin'));
  });

  it('member has member', () => {
    assert.ok(hasRole(testPrincipal, 'member'));
  });
});

describe('principalFromClaims', () => {
  it('extracts principal fields from claims', () => {
    const secret = makeSecret();
    const { token } = issueAccessToken(testPrincipal, secret);
    const claims = verifyAccessToken(token, secret);
    const principal = principalFromClaims(claims);
    assert.equal(principal.sub, testPrincipal.sub);
    assert.equal(principal.email, testPrincipal.email);
    assert.equal(principal.name, testPrincipal.name);
    assert.deepEqual(principal.roles, testPrincipal.roles);
  });
});
