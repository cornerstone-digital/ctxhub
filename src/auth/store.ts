import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { StoredTokens } from './types.js';

export function getTokenStorePath(): string {
  return path.join(getCtxhubHome(), 'tokens.json');
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const storePath = getTokenStorePath();
  if (!(await pathExists(storePath))) return null;
  try {
    return JSON.parse(await readText(storePath)) as StoredTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  // tokens.json contains credentials — write atomically via writeText's tmp-rename pattern
  await writeText(getTokenStorePath(), `${JSON.stringify(tokens, null, 2)}\n`);
}

export async function clearTokens(): Promise<void> {
  const storePath = getTokenStorePath();
  if (await pathExists(storePath)) {
    await unlink(storePath);
  }
}

/** Returns true if the token is expired or within 60 seconds of expiry */
export function isTokenExpired(expiresAt: string, bufferSeconds = 60): boolean {
  return new Date(expiresAt).getTime() <= Date.now() + bufferSeconds * 1000;
}
