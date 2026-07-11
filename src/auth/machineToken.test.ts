/**
 * Tests for machine token generation, storage, and hash round-trip.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRawToken, loadMachineTokenStore, hashToken, verifyToken } from './machineTokenStore.js';

describe('generateRawToken', () => {
  it('starts with ctxm_', () => {
    const token = generateRawToken();
    assert.ok(token.startsWith('ctxm_'), `expected ctxm_ prefix, got: ${token.substring(0, 10)}`);
  });

  it('is 69 characters total (ctxm_ + 64 hex)', () => {
    const token = generateRawToken();
    assert.equal(token.length, 69, `expected 69 chars, got: ${token.length}`);
  });

  it('generates unique tokens', () => {
    const t1 = generateRawToken();
    const t2 = generateRawToken();
    assert.notEqual(t1, t2, 'tokens should be unique');
  });

  it('has valid hex chars after prefix', () => {
    const token = generateRawToken();
    const hex = token.slice(5);
    assert.ok(/^[0-9a-f]{64}$/.test(hex), `hex part should be 64 lowercase hex chars, got: ${hex}`);
  });
});

describe('loadMachineTokenStore', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ctxhub-test-'));
    originalHome = process.env['CTXHUB_HOME'];
    process.env['CTXHUB_HOME'] = tmpDir;
  });

  after(async () => {
    if (originalHome !== undefined) {
      process.env['CTXHUB_HOME'] = originalHome;
    } else {
      delete process.env['CTXHUB_HOME'];
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty store when file does not exist', async () => {
    const store = await loadMachineTokenStore();
    assert.equal(store.version, 1);
    assert.deepEqual(store.tokens, []);
  });
});

describe('hashToken / verifyToken round-trip', () => {
  it('verifyToken returns true for matching token', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const result = await verifyToken(raw, hash);
    assert.equal(result, true);
  });

  it('verifyToken returns false for wrong token', async () => {
    const raw = generateRawToken();
    const wrongRaw = generateRawToken();
    const hash = await hashToken(raw);
    const result = await verifyToken(wrongRaw, hash);
    assert.equal(result, false);
  });

  it('hash string has correct format', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const parts = hash.split(':');
    assert.equal(parts[0], 'scrypt');
    assert.equal(parts[1], '16384'); // N
    assert.equal(parts[2], '8');     // r
    assert.equal(parts[3], '1');     // p
    assert.ok(/^[0-9a-f]{32}$/.test(parts[4]), 'salt should be 32 hex chars (16 bytes)');
    assert.ok(/^[0-9a-f]{64}$/.test(parts[5]), 'hash should be 64 hex chars (32 bytes)');
  });

  it('returns false for malformed hash string', async () => {
    const raw = generateRawToken();
    const result = await verifyToken(raw, 'not-a-valid-hash');
    assert.equal(result, false);
  });
});
