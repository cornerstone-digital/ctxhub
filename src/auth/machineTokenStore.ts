import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { MachineToken, MachineTokenStore } from './types.js';

// scrypt parameters
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export function getMachineTokenStorePath(): string {
  return path.join(getCtxhubHome(), 'machine-tokens.json');
}

export async function loadMachineTokenStore(): Promise<MachineTokenStore> {
  const storePath = getMachineTokenStorePath();
  if (!(await pathExists(storePath))) {
    return { version: 1, tokens: [] };
  }
  try {
    const raw = await readText(storePath);
    return JSON.parse(raw) as MachineTokenStore;
  } catch {
    return { version: 1, tokens: [] };
  }
}

export async function saveMachineTokenStore(store: MachineTokenStore): Promise<void> {
  await writeText(getMachineTokenStorePath(), `${JSON.stringify(store, null, 2)}\n`);
}

export async function findMachineToken(id: string): Promise<MachineToken | undefined> {
  const store = await loadMachineTokenStore();
  return store.tokens.find(t => t.id === id);
}

/**
 * Generate a raw machine token: `ctxm_` + 64 hex chars (32 random bytes).
 * Total length: 5 + 64 = 69 chars.
 */
export function generateRawToken(): string {
  return `ctxm_${randomBytes(32).toString('hex')}`;
}

/**
 * Hash a raw token using scrypt.
 * Returns a string: `scrypt:<N>:<r>:<p>:<salt_hex>:<hash_hex>`
 *
 * Uses scryptSync — token operations are infrequent (create/verify), so
 * synchronous is fine and avoids type-system friction with promisified scrypt.
 */
export async function hashToken(rawToken: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = scryptSync(rawToken, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verify a raw token against a stored hash string.
 * Returns true if the token matches the hash.
 */
export async function verifyToken(rawToken: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  try {
    const actual = scryptSync(rawToken, salt, expected.length, {
      N: parseInt(N, 10),
      r: parseInt(r, 10),
      p: parseInt(p, 10),
    });

    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
