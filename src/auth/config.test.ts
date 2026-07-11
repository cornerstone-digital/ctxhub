import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { loadAuthConfig, saveAuthConfig, isAuthConfigured } from './config.js';
import type { AuthConfig } from './types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Saved env vars so we can restore them after each test. */
const ENV_KEYS = ['CTXHUB_TENANT_ID', 'CTXHUB_CLIENT_ID', 'CTXHUB_CLIENT_SECRET', 'CTXHUB_JWT_SECRET'] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

function clearAuthEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function setAllAuthEnv(overrides: Partial<Record<typeof ENV_KEYS[number], string>> = {}): void {
  process.env['CTXHUB_TENANT_ID'] = overrides['CTXHUB_TENANT_ID'] ?? 'env-tenant-id';
  process.env['CTXHUB_CLIENT_ID'] = overrides['CTXHUB_CLIENT_ID'] ?? 'env-client-id';
  process.env['CTXHUB_CLIENT_SECRET'] = overrides['CTXHUB_CLIENT_SECRET'] ?? 'env-client-secret';
  process.env['CTXHUB_JWT_SECRET'] = overrides['CTXHUB_JWT_SECRET'] ?? 'env-jwt-secret-hex-32-bytes-long!';
}

const fileConfig: AuthConfig = {
  version: 1,
  oidc: {
    tenantId: 'file-tenant-id',
    clientId: 'file-client-id',
    clientSecret: 'file-client-secret',
    redirectUri: 'http://localhost:7842/callback',
  },
  jwtSecret: 'file-jwt-secret-value-hex-encoded',
};

// Redirect CTXHUB_HOME to a temp dir so tests don't touch the real auth.json.
async function withTempHome(run: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-auth-config-'));
  const savedHome = process.env['CTXHUB_HOME'];
  process.env['CTXHUB_HOME'] = tmpDir;
  try {
    await run(tmpDir);
  } finally {
    if (savedHome === undefined) {
      delete process.env['CTXHUB_HOME'];
    } else {
      process.env['CTXHUB_HOME'] = savedHome;
    }
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('loadAuthConfig — env vars only', () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => { savedEnv = saveEnv(); clearAuthEnv(); });
  afterEach(() => restoreEnv(savedEnv));

  it('returns a valid AuthConfig when all 4 env vars are set and no file exists', async () => {
    await withTempHome(async () => {
      setAllAuthEnv();
      const config = await loadAuthConfig();
      assert.ok(config !== null);
      assert.equal(config!.oidc.tenantId, 'env-tenant-id');
      assert.equal(config!.oidc.clientId, 'env-client-id');
      assert.equal(config!.oidc.clientSecret, 'env-client-secret');
      assert.equal(config!.jwtSecret, 'env-jwt-secret-hex-32-bytes-long!');
    });
  });

  it('env vars take precedence over file values', async () => {
    await withTempHome(async () => {
      await saveAuthConfig(fileConfig);
      // Set all env vars so the env-only path is taken; these should win over file
      setAllAuthEnv({
        CTXHUB_TENANT_ID: 'env-tenant-OVERRIDE',
        CTXHUB_CLIENT_ID: 'env-client-OVERRIDE',
        CTXHUB_CLIENT_SECRET: 'env-secret-OVERRIDE',
        CTXHUB_JWT_SECRET: 'env-jwt-OVERRIDE',
      });
      const config = await loadAuthConfig();
      assert.ok(config !== null);
      assert.equal(config!.oidc.tenantId, 'env-tenant-OVERRIDE');
      assert.equal(config!.oidc.clientId, 'env-client-OVERRIDE');
      assert.equal(config!.oidc.clientSecret, 'env-secret-OVERRIDE');
      assert.equal(config!.jwtSecret, 'env-jwt-OVERRIDE');
      // redirectUri should still come from the file config
      assert.equal(config!.oidc.redirectUri, fileConfig.oidc.redirectUri);
    });
  });

  it('missing env vars fall back to file values', async () => {
    await withTempHome(async () => {
      await saveAuthConfig(fileConfig);
      // No env vars set
      const config = await loadAuthConfig();
      assert.ok(config !== null);
      assert.equal(config!.oidc.tenantId, 'file-tenant-id');
      assert.equal(config!.oidc.clientId, 'file-client-id');
      assert.equal(config!.oidc.clientSecret, 'file-client-secret');
      assert.equal(config!.jwtSecret, 'file-jwt-secret-value-hex-encoded');
    });
  });

  it('returns null when neither env vars nor file provide a config', async () => {
    await withTempHome(async () => {
      // No file, no env vars
      const config = await loadAuthConfig();
      assert.equal(config, null);
    });
  });
});

describe('isAuthConfigured — env vars', () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => { savedEnv = saveEnv(); clearAuthEnv(); });
  afterEach(() => restoreEnv(savedEnv));

  it('returns true when all 4 env vars are present', async () => {
    await withTempHome(async () => {
      setAllAuthEnv();
      const result = await isAuthConfigured();
      assert.equal(result, true);
    });
  });

  it('returns false when neither env vars nor file are present', async () => {
    await withTempHome(async () => {
      const result = await isAuthConfigured();
      assert.equal(result, false);
    });
  });

  it('returns true with a complete file config and no env vars', async () => {
    await withTempHome(async () => {
      await saveAuthConfig(fileConfig);
      const result = await isAuthConfigured();
      assert.equal(result, true);
    });
  });
});
