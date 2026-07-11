import { createHmac, createHash, randomBytes } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { createContextPack } from '../context/pack.js';
import { getCtxhubHome } from '../workspaces/registry.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
// Avoid circular dependency with server.ts (server.ts imports from share.ts)
const DEFAULT_SERVICE_PORT = 7342;

// ── Share signing ─────────────────────────────────────────────────────────────

const SHARE_ISSUER = 'ctxhub-share';
const DEFAULT_TTL_S = 86_400; // 24 hours

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(headerDotPayload: string, secret: Buffer): string {
  return base64url(createHmac('sha256', secret).update(headerDotPayload).digest());
}

export function issueShareToken(
  payload: ShareTokenPayload,
  secret: string,
): string {
  const secretBuf = Buffer.from(secret, 'hex');
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payloadEncoded = base64url(Buffer.from(JSON.stringify(payload)));
  const signature = sign(`${header}.${payloadEncoded}`, secretBuf);
  return `${header}.${payloadEncoded}.${signature}`;
}

export function verifyShareToken(token: string, secret: string): ShareTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed share token');

  const [header, payloadEncoded, signature] = parts as [string, string, string];
  const secretBuf = Buffer.from(secret, 'hex');
  const expected = sign(`${header}.${payloadEncoded}`, secretBuf);

  if (signature !== expected) throw new Error('Invalid share token signature');

  const payload = JSON.parse(base64urlDecode(payloadEncoded).toString('utf-8')) as ShareTokenPayload;
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp < now) throw new Error('Share token expired');
  if (payload.iss !== SHARE_ISSUER) throw new Error('Invalid share token issuer');

  return payload;
}

export interface ShareTokenPayload {
  jti: string;       // UUID — file key under ~/.ctxhub/shares/
  query: string;
  packHash: string;  // sha256 of pack JSON
  exp: number;       // Unix timestamp
  iss: string;       // 'ctxhub-share'
  oneTime?: boolean; // delete after serving
}

// ── Secret management ─────────────────────────────────────────────────────────

export function getSharesDir(): string {
  return path.join(getCtxhubHome(), 'shares');
}

export function getShareSecretPath(): string {
  return path.join(getCtxhubHome(), 'share-secret.json');
}

export async function getShareSecret(): Promise<string> {
  // Prefer the main auth jwtSecret when auth is configured
  try {
    const { loadAuthConfig } = await import('../auth/config.js');
    const authConfig = await loadAuthConfig();
    if (authConfig?.jwtSecret) return authConfig.jwtSecret;
  } catch {
    // fall through
  }

  // Fall back to a local share-specific secret
  const secretPath = getShareSecretPath();
  if (await pathExists(secretPath)) {
    const raw = await readText(secretPath);
    const parsed = JSON.parse(raw) as { secret: string };
    if (parsed.secret) return parsed.secret;
  }

  // Generate a new one
  const secret = randomBytes(32).toString('hex');
  await writeText(secretPath, `${JSON.stringify({ secret }, null, 2)}\n`);
  return secret;
}

// ── sha256 hash helper ────────────────────────────────────────────────────────

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ── shareCommand ──────────────────────────────────────────────────────────────

export async function shareCommand(
  query: string,
  opts: { ttl?: string; limit?: string; port?: string; oneTime?: boolean } = {},
): Promise<void> {
  const ttlSeconds = opts.ttl ? Number(opts.ttl) : DEFAULT_TTL_S;
  const limit = opts.limit ? Number(opts.limit) : 8;
  const port = opts.port ?? String(DEFAULT_SERVICE_PORT);

  const pack = await createContextPack(query, limit);
  const packJson = JSON.stringify(pack);
  const packHash = sha256hex(packJson);

  const secret = await getShareSecret();
  const jti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const payload: ShareTokenPayload = {
    jti,
    query,
    packHash,
    exp: now + ttlSeconds,
    iss: SHARE_ISSUER,
    ...(opts.oneTime ? { oneTime: true } : {}),
  };

  const token = issueShareToken(payload, secret);

  // Persist the pack and sidecar metadata
  const sharesDir = getSharesDir();
  await ensureDir(sharesDir);
  const packPath = path.join(sharesDir, `${jti}.json`);
  await writeText(packPath, `${packJson}\n`);
  const metaPath = path.join(sharesDir, `${jti}.meta.json`);
  await writeText(metaPath, `${JSON.stringify({ query, exp: now + ttlSeconds, oneTime: !!opts.oneTime }, null, 2)}\n`);

  const expiresAt = new Date((now + ttlSeconds) * 1000).toISOString();

  console.log(chalk.bold('Share token:'));
  console.log(token);
  console.log('');
  console.log(chalk.bold('Share URL:'));
  console.log(chalk.green(`http://localhost:${port}/share/${token}`));
  console.log('');
  console.log(chalk.gray(`Query: ${query}`));
  console.log(chalk.gray(`Expires: ${expiresAt}`));
  if (opts.oneTime) console.log(chalk.yellow('One-time use: pack will be deleted after first access.'));
}

// ── shareListCommand ──────────────────────────────────────────────────────────

export async function shareListCommand(): Promise<void> {
  const sharesDir = getSharesDir();
  if (!(await pathExists(sharesDir))) {
    console.log(chalk.gray('No active shares.'));
    return;
  }

  const files = (await readdir(sharesDir)).filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'));
  if (files.length === 0) {
    console.log(chalk.gray('No active shares.'));
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const secret = await getShareSecret();
  const rows: Array<{ jti: string; query: string; expires: string; expired: boolean }> = [];

  for (const file of files) {
    const jti = file.replace(/\.json$/, '');
    // We can't decode the full token just from the file — store metadata alongside
    // For now read a sidecar if present, or just show jti
    const sidecarPath = path.join(sharesDir, `${jti}.meta.json`);
    if (await pathExists(sidecarPath)) {
      try {
        const meta = JSON.parse(await readText(sidecarPath)) as { query: string; exp: number };
        const expired = meta.exp < now;
        rows.push({
          jti,
          query: meta.query,
          expires: new Date(meta.exp * 1000).toISOString(),
          expired,
        });
      } catch {
        rows.push({ jti, query: '(unknown)', expires: '(unknown)', expired: false });
      }
    } else {
      rows.push({ jti, query: '(unknown)', expires: '(unknown)', expired: false });
    }
  }

  if (rows.length === 0) {
    console.log(chalk.gray('No active shares.'));
    return;
  }

  console.log(chalk.bold('Active shares:'));
  for (const row of rows) {
    const status = row.expired ? chalk.red('[expired]') : chalk.green('[active]');
    console.log(`  ${status} ${row.jti}`);
    console.log(chalk.gray(`    Query:   ${row.query}`));
    console.log(chalk.gray(`    Expires: ${row.expires}`));
  }
  void secret; // suppress unused warning
}

// ── shareRevokeCommand ────────────────────────────────────────────────────────

export async function shareRevokeCommand(tokenId: string): Promise<void> {
  const sharesDir = getSharesDir();
  const packPath = path.join(sharesDir, `${tokenId}.json`);
  const metaPath = path.join(sharesDir, `${tokenId}.meta.json`);

  let removed = false;
  if (await pathExists(packPath)) {
    await rm(packPath, { force: true });
    removed = true;
  }
  if (await pathExists(metaPath)) {
    await rm(metaPath, { force: true });
  }

  if (removed) {
    console.log(chalk.green(`Revoked share: ${tokenId}`));
  } else {
    console.log(chalk.yellow(`No share found with id: ${tokenId}`));
  }
}
