import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import {
  issueShareToken,
  verifyShareToken,
  shareListCommand,
  shareRevokeCommand,
  getSharesDir,
  type ShareTokenPayload,
} from './share.js';
import { createServiceServer } from '../service/server.js';
import { pathExists, writeText } from '../utils/fs.js';
import { randomBytes } from 'node:crypto';

// ── helpers ───────────────────────────────────────────────────────────────────

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-share-home-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = ctxhubHome;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(ctxhubHome, { recursive: true, force: true });
  }
}

async function withRunningServer(run: (baseUrl: string) => Promise<void>) {
  const server = createServiceServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

function makeSecret(): string {
  return randomBytes(32).toString('hex');
}

function makePayload(overrides: Partial<ShareTokenPayload> = {}): ShareTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    jti: crypto.randomUUID(),
    query: 'test query',
    packHash: 'abc123',
    exp: now + 3600,
    iss: 'ctxhub-share',
    ...overrides,
  };
}

// ── issueShareToken / verifyShareToken ────────────────────────────────────────

test('issueShareToken produces a 3-part JWT', () => {
  const secret = makeSecret();
  const payload = makePayload();
  const token = issueShareToken(payload, secret);
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'token must have 3 dot-separated parts');
  // Each part should be non-empty base64url
  for (const part of parts) {
    assert.ok(part.length > 0, 'token part must not be empty');
    assert.doesNotMatch(part, /[+/=]/, 'token parts must be base64url encoded (no +, /, or =)');
  }
});

test('issueShareToken header encodes alg HS256 typ JWT', () => {
  const secret = makeSecret();
  const payload = makePayload();
  const token = issueShareToken(payload, secret);
  const headerB64 = token.split('.')[0]!;
  const header = JSON.parse(Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')) as Record<string, string>;
  assert.equal(header.alg, 'HS256');
  assert.equal(header.typ, 'JWT');
});

test('verifyShareToken returns payload for a valid token', () => {
  const secret = makeSecret();
  const payload = makePayload();
  const token = issueShareToken(payload, secret);
  const result = verifyShareToken(token, secret);
  assert.equal(result.jti, payload.jti);
  assert.equal(result.query, payload.query);
  assert.equal(result.iss, 'ctxhub-share');
});

test('verifyShareToken throws on invalid signature', () => {
  const secret1 = makeSecret();
  const secret2 = makeSecret();
  const payload = makePayload();
  const token = issueShareToken(payload, secret1);
  assert.throws(() => verifyShareToken(token, secret2), /Invalid share token signature/);
});

test('verifyShareToken throws on expired token', () => {
  const secret = makeSecret();
  const payload = makePayload({ exp: Math.floor(Date.now() / 1000) - 1 });
  const token = issueShareToken(payload, secret);
  assert.throws(() => verifyShareToken(token, secret), /expired/);
});

test('verifyShareToken throws on malformed token (not 3 parts)', () => {
  const secret = makeSecret();
  assert.throws(() => verifyShareToken('not.a.valid.jwt.token', secret), /Malformed/);
  assert.throws(() => verifyShareToken('onlyone', secret), /Malformed/);
});

// ── shareListCommand ──────────────────────────────────────────────────────────

test('shareListCommand reports no active shares when directory is empty', () => {
  return withIsolatedCtxhubHome(async () => {
    const lines = await captureLog(() => shareListCommand());
    assert.ok(lines.some(line => line.includes('No active shares')));
  });
});

test('shareListCommand shows entries for shares with sidecar metadata', () => {
  return withIsolatedCtxhubHome(async () => {
    const sharesDir = getSharesDir();
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // Write a fake pack + meta
    await writeText(path.join(sharesDir, `${jti}.json`), JSON.stringify({ files: [] }));
    await writeText(
      path.join(sharesDir, `${jti}.meta.json`),
      JSON.stringify({ query: 'my-test-query', exp: now + 3600, oneTime: false })
    );

    const lines = await captureLog(() => shareListCommand());
    assert.ok(lines.some(line => line.includes(jti)), 'should list the jti');
    assert.ok(lines.some(line => line.includes('my-test-query')), 'should show the query');
  });
});

test('shareListCommand marks expired entries with [expired]', () => {
  return withIsolatedCtxhubHome(async () => {
    const sharesDir = getSharesDir();
    const jti = crypto.randomUUID();
    const past = Math.floor(Date.now() / 1000) - 100;

    await writeText(path.join(sharesDir, `${jti}.json`), JSON.stringify({}));
    await writeText(
      path.join(sharesDir, `${jti}.meta.json`),
      JSON.stringify({ query: 'expired query', exp: past, oneTime: false })
    );

    const lines = await captureLog(() => shareListCommand());
    assert.ok(lines.some(line => line.includes('[expired]') || line.includes('expired')), 'should flag expired shares');
  });
});

// ── shareRevokeCommand ────────────────────────────────────────────────────────

test('shareRevokeCommand deletes pack and meta files', () => {
  return withIsolatedCtxhubHome(async () => {
    const sharesDir = getSharesDir();
    const jti = crypto.randomUUID();
    const packPath = path.join(sharesDir, `${jti}.json`);
    const metaPath = path.join(sharesDir, `${jti}.meta.json`);

    await writeText(packPath, JSON.stringify({ files: [] }));
    await writeText(metaPath, JSON.stringify({ query: 'q', exp: 9999999999, oneTime: false }));

    assert.equal(await pathExists(packPath), true);
    assert.equal(await pathExists(metaPath), true);

    await captureLog(() => shareRevokeCommand(jti));

    assert.equal(await pathExists(packPath), false, 'pack file should be deleted');
    assert.equal(await pathExists(metaPath), false, 'meta file should be deleted');
  });
});

test('shareRevokeCommand reports when no share is found', () => {
  return withIsolatedCtxhubHome(async () => {
    const lines = await captureLog(() => shareRevokeCommand('nonexistent-jti'));
    assert.ok(lines.some(line => line.includes('No share found')));
  });
});

// ── GET /share/:token HTTP route ──────────────────────────────────────────────

test('GET /share/:token returns 200 with pack when token is valid', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      // Write a share secret so both the server and our token use the same key
      const secret = makeSecret();
      const secretPath = path.join(process.env.CTXHUB_HOME!, 'share-secret.json');
      await writeText(secretPath, JSON.stringify({ secret }));

      const sharesDir = getSharesDir();
      const jti = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const packData = { files: [{ name: 'README.md', content: 'hello' }] };

      await writeText(path.join(sharesDir, `${jti}.json`), JSON.stringify(packData));
      await writeText(
        path.join(sharesDir, `${jti}.meta.json`),
        JSON.stringify({ query: 'test', exp: now + 3600, oneTime: false })
      );

      const payload = makePayload({ jti, exp: now + 3600 });
      const token = issueShareToken(payload, secret);

      const res = await fetch(`${baseUrl}/share/${token}`);
      assert.equal(res.status, 200, 'should return 200 for valid token');
      const body = await res.json() as typeof packData;
      assert.deepEqual(body, packData, 'should return the pack JSON');
    })
  );
});

test('GET /share/:token returns 401 when token signature is invalid', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      // Mismatch: server will load its own (newly generated) secret
      const otherSecret = makeSecret();
      const payload = makePayload();
      const token = issueShareToken(payload, otherSecret);

      const res = await fetch(`${baseUrl}/share/${token}`);
      assert.equal(res.status, 401, 'should return 401 for invalid signature');
    })
  );
});

test('GET /share/:token returns 401 when token is expired', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const secret = makeSecret();
      const secretPath = path.join(process.env.CTXHUB_HOME!, 'share-secret.json');
      await writeText(secretPath, JSON.stringify({ secret }));

      const payload = makePayload({ exp: Math.floor(Date.now() / 1000) - 10 });
      const token = issueShareToken(payload, secret);

      const res = await fetch(`${baseUrl}/share/${token}`);
      assert.equal(res.status, 401, 'should return 401 for expired token');
    })
  );
});

test('GET /share/:token returns 404 when pack file is missing', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const secret = makeSecret();
      const secretPath = path.join(process.env.CTXHUB_HOME!, 'share-secret.json');
      await writeText(secretPath, JSON.stringify({ secret }));

      // Valid token but no pack file written
      const payload = makePayload();
      const token = issueShareToken(payload, secret);

      const res = await fetch(`${baseUrl}/share/${token}`);
      assert.equal(res.status, 404, 'should return 404 when pack file is missing');
    })
  );
});
