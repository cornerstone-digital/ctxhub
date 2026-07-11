import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generatePkce, generateState } from './pkce.js';

describe('generatePkce', () => {
  it('returns a verifier and challenge', () => {
    const { verifier, challenge } = generatePkce();
    assert.ok(verifier.length >= 43, 'verifier too short');
    assert.ok(challenge.length > 0, 'challenge empty');
  });

  it('challenge is S256(verifier)', () => {
    const { verifier, challenge } = generatePkce();
    const expected = Buffer.from(createHash('sha256').update(verifier).digest())
      .toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    assert.equal(challenge, expected);
  });

  it('generates unique pairs on each call', () => {
    const a = generatePkce();
    const b = generatePkce();
    assert.notEqual(a.verifier, b.verifier);
    assert.notEqual(a.challenge, b.challenge);
  });

  it('uses only URL-safe characters', () => {
    for (let i = 0; i < 20; i++) {
      const { verifier, challenge } = generatePkce();
      assert.match(verifier, /^[A-Za-z0-9\-_]+$/);
      assert.match(challenge, /^[A-Za-z0-9\-_]+$/);
    }
  });
});

describe('generateState', () => {
  it('returns a hex string', () => {
    const state = generateState();
    assert.match(state, /^[0-9a-f]+$/);
    assert.equal(state.length, 32); // 16 bytes → 32 hex chars
  });

  it('is unique on each call', () => {
    const states = new Set(Array.from({ length: 10 }, generateState));
    assert.equal(states.size, 10);
  });
});
