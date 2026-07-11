import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { buildEnterpriseChecks, type CheckLine } from './doctorChecks.js';
import { defaultConfig } from '../config/defaultConfig.js';

// Environment variable names that affect auth / home resolution
const AUTH_ENV_KEYS = [
  'CTXHUB_HOME',
  'CTXHUB_TENANT_ID',
  'CTXHUB_CLIENT_ID',
  'CTXHUB_CLIENT_SECRET',
  'CTXHUB_JWT_SECRET',
] as const;

type AuthEnv = Partial<Record<(typeof AUTH_ENV_KEYS)[number], string>>;

/**
 * Run `fn` with CTXHUB_HOME pointing at a fresh temp directory and the
 * supplied auth env vars set.  All AUTH_ENV_KEYS are cleared before the
 * overrides are applied, then restored on exit.
 */
async function withIsolatedHome(
  overrides: AuthEnv,
  fn: (home: string) => Promise<void>
): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-ent-doctor-'));
  const saved: Record<string, string | undefined> = {};

  for (const key of AUTH_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env['CTXHUB_HOME'] = home;
  for (const [key, val] of Object.entries(overrides) as [string, string][]) {
    if (val !== undefined) process.env[key] = val;
  }

  try {
    await fn(home);
  } finally {
    for (const key of AUTH_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key]!;
      }
    }
    await rm(home, { recursive: true, force: true });
  }
}

// A valid 32-byte hex key (all 'a's is fine for tests)
const FAKE_JWT_SECRET = 'a'.repeat(64);

const VALID_AUTH_ENV: AuthEnv = {
  CTXHUB_TENANT_ID: 'test-tenant-id',
  CTXHUB_CLIENT_ID: 'test-client-id',
  CTXHUB_CLIENT_SECRET: 'test-client-secret',
  CTXHUB_JWT_SECRET: FAKE_JWT_SECRET,
};

/** Run a single named enterprise check and return its lines. */
async function runCheck(id: string): Promise<CheckLine[]> {
  const checks = buildEnterpriseChecks(defaultConfig);
  const check = checks.find(c => c.id === id);
  if (!check) throw new Error(`Check "${id}" not found in buildEnterpriseChecks`);
  return check.run();
}

// ── enterprise-auth ───────────────────────────────────────────────────────────

test('enterprise-auth: ok when all four env vars are set', async () => {
  await withIsolatedHome(VALID_AUTH_ENV, async () => {
    const lines = await runCheck('enterprise-auth');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'ok');
    assert.ok(lines[0].message.includes('Entra ID configured'));
  });
});

test('enterprise-auth: error when no env vars and no auth.json', async () => {
  await withIsolatedHome({}, async () => {
    const lines = await runCheck('enterprise-auth');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'error');
    assert.ok(lines[0].message.includes('not configured'));
  });
});

test('enterprise-auth: ok when auth.json exists with full config', async () => {
  await withIsolatedHome({}, async home => {
    const authConfig = {
      version: 1,
      oidc: {
        tenantId: 'tenant-from-file',
        clientId: 'client-from-file',
        clientSecret: 'secret-from-file',
        redirectUri: 'http://localhost:3000/callback',
      },
      jwtSecret: FAKE_JWT_SECRET,
    };
    await writeFile(path.join(home, 'auth.json'), JSON.stringify(authConfig));
    const lines = await runCheck('enterprise-auth');
    assert.equal(lines[0].status, 'ok');
  });
});

// ── enterprise-session ────────────────────────────────────────────────────────

test('enterprise-session: skips (returns empty) when auth not configured', async () => {
  await withIsolatedHome({}, async () => {
    const lines = await runCheck('enterprise-session');
    assert.equal(lines.length, 0, 'session check should return no lines when auth is not configured');
  });
});

test('enterprise-session: warn when auth configured but no tokens file', async () => {
  await withIsolatedHome(VALID_AUTH_ENV, async () => {
    // No tokens.json in home dir
    const lines = await runCheck('enterprise-session');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'warn');
    assert.ok(lines[0].message.includes('ctxhub login'));
  });
});

test('enterprise-session: warn when tokens file present but token is expired', async () => {
  await withIsolatedHome(VALID_AUTH_ENV, async home => {
    const pastDate = new Date(Date.now() - 7200 * 1000).toISOString(); // 2 hours ago
    const tokens = {
      version: 1,
      entraTokens: {
        accessToken: 'entra-access',
        refreshToken: 'entra-refresh',
        idToken: 'entra-id',
        expiresAt: pastDate,
      },
      ctxhubToken: {
        token: 'ctxhub-token-value',
        expiresAt: pastDate,
      },
      user: { sub: 'user-sub', email: 'user@example.com', name: 'Test User' },
    };
    await writeFile(path.join(home, 'tokens.json'), JSON.stringify(tokens));
    const lines = await runCheck('enterprise-session');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'warn');
    assert.ok(lines[0].message.includes('ctxhub login'));
  });
});

test('enterprise-session: ok when tokens file present with future expiry', async () => {
  await withIsolatedHome(VALID_AUTH_ENV, async home => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour from now
    const tokens = {
      version: 1,
      entraTokens: {
        accessToken: 'entra-access',
        refreshToken: 'entra-refresh',
        idToken: 'entra-id',
        expiresAt: futureDate,
      },
      ctxhubToken: {
        token: 'ctxhub-token-value',
        expiresAt: futureDate,
      },
      user: { sub: 'user-sub', email: 'alice@example.com', name: 'Alice' },
    };
    await writeFile(path.join(home, 'tokens.json'), JSON.stringify(tokens));
    const lines = await runCheck('enterprise-session');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'ok');
    assert.ok(lines[0].message.includes('alice@example.com'));
  });
});

// ── enterprise-role-map ───────────────────────────────────────────────────────

test('enterprise-role-map: skips (returns empty) when auth not configured', async () => {
  await withIsolatedHome({}, async () => {
    const lines = await runCheck('enterprise-role-map');
    assert.equal(lines.length, 0);
  });
});

test('enterprise-role-map: warn when auth configured but role map is empty', async () => {
  // env-var-only auth config has no roleMap
  await withIsolatedHome(VALID_AUTH_ENV, async () => {
    const lines = await runCheck('enterprise-role-map');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'warn');
    assert.ok(lines[0].message.includes('empty'));
  });
});

test('enterprise-role-map: ok when auth.json has ownerSubs entries', async () => {
  await withIsolatedHome({}, async home => {
    const authConfig = {
      version: 1,
      oidc: {
        tenantId: 'tenant',
        clientId: 'client',
        clientSecret: 'secret',
        redirectUri: '',
      },
      jwtSecret: FAKE_JWT_SECRET,
      roleMap: {
        ownerSubs: ['some-entra-oid'],
        groupRoles: {},
      },
    };
    await writeFile(path.join(home, 'auth.json'), JSON.stringify(authConfig));
    const lines = await runCheck('enterprise-role-map');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'ok');
    assert.ok(lines[0].message.includes('configured'));
  });
});

test('enterprise-role-map: ok when auth.json has groupRoles entries', async () => {
  await withIsolatedHome({}, async home => {
    const authConfig = {
      version: 1,
      oidc: {
        tenantId: 'tenant',
        clientId: 'client',
        clientSecret: 'secret',
        redirectUri: '',
      },
      jwtSecret: FAKE_JWT_SECRET,
      roleMap: {
        ownerSubs: [],
        groupRoles: { 'entra-group-id': 'admin' },
      },
    };
    await writeFile(path.join(home, 'auth.json'), JSON.stringify(authConfig));
    const lines = await runCheck('enterprise-role-map');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'ok');
  });
});

// ── enterprise-groups ─────────────────────────────────────────────────────────

test('enterprise-groups: ok when groups.json does not exist (empty store)', async () => {
  await withIsolatedHome({}, async () => {
    const lines = await runCheck('enterprise-groups');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'ok');
    assert.ok(lines[0].message.includes('OK'));
  });
});

test('enterprise-groups: error when groups.json is corrupted JSON', async () => {
  await withIsolatedHome({}, async home => {
    await writeFile(path.join(home, 'groups.json'), '{ this is not valid JSON }');
    const lines = await runCheck('enterprise-groups');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'error');
    assert.ok(lines[0].message.includes('corrupted'));
  });
});

test('enterprise-groups: ok when groups.json has valid content', async () => {
  await withIsolatedHome({}, async home => {
    const store = {
      version: 1,
      groups: [{ id: 'grp-1', name: 'Test Group', createdAt: new Date().toISOString(), createdBy: 'cli' }],
      orgs: [],
      sharingPolicies: [],
    };
    await writeFile(path.join(home, 'groups.json'), JSON.stringify(store));
    const lines = await runCheck('enterprise-groups');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 'ok');
  });
});
