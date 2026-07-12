/**
 * Integration tests for db.ts against a REAL Postgres instance.
 *
 * Skipped by default -- these do not run as part of `npm test` and never have in CI,
 * because the rest of the suite is deliberately self-contained with no external
 * services. Point DATABASE_URL at a scratch Postgres to run them, e.g.:
 *
 *   docker run -d --name ctxhub-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ctxhub \
 *     -p 15432:5432 postgres:17-alpine
 *   DATABASE_URL=postgres://postgres:test@localhost:15432/ctxhub \
 *     node --import tsx --test src/cloud/db.integration.test.ts
 *
 * Validated once (2026-07-12) against a local Postgres 17 container -- confirms the
 * schema and queries are shaped correctly, NOT that this holds up against a real
 * Railway/production instance under concurrent load or partial-failure conditions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  applySchema,
  createOrg,
  findOrgBySlug,
  createMember,
  listMembersByOrg,
  createWorkspace,
  listWorkspacesByOrg,
  createMachine,
  findMachineByHashedToken,
  listMachinesByOrg,
  revokeMachine,
} from './db.js';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl ? 'set DATABASE_URL to run against a real Postgres instance' : false;

test('cloud db integration', { skip }, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl });

  // Fresh schema for this run -- drop and recreate so the test is repeatable.
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await applySchema(pool);

  await t.test('creates and finds an org by slug', async () => {
    const slug = `test-org-${randomUUID()}`;
    const org = await createOrg(pool, 'Test Org', slug, 'entra-tenant-123');
    assert.equal(org.slug, slug);
    assert.equal(org.entraTenantId, 'entra-tenant-123');

    const found = await findOrgBySlug(pool, slug);
    assert.equal(found?.id, org.id);
  });

  await t.test('creates members scoped to an org', async () => {
    const org = await createOrg(pool, 'Member Test Org', `member-org-${randomUUID()}`);
    await createMember(pool, org.id, 'entra-sub-1', 'alice@example.com', 'Alice', 'admin');
    await createMember(pool, org.id, 'entra-sub-2', 'bob@example.com', 'Bob');

    const members = await listMembersByOrg(pool, org.id);
    assert.equal(members.length, 2);
    assert.equal(members.find(m => m.email === 'alice@example.com')?.role, 'admin');
    assert.equal(members.find(m => m.email === 'bob@example.com')?.role, 'member');
  });

  await t.test('creates workspaces scoped to an org', async () => {
    const org = await createOrg(pool, 'Workspace Test Org', `ws-org-${randomUUID()}`);
    await createWorkspace(pool, org.id, 'Main Repo', 'main-repo');

    const workspaces = await listWorkspacesByOrg(pool, org.id);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].slug, 'main-repo');
  });

  await t.test('creates, finds, lists, and revokes machines', async () => {
    const org = await createOrg(pool, 'Machine Test Org', `machine-org-${randomUUID()}`);
    const hashedToken = `scrypt:16384:8:1:${randomUUID()}:fakehash`;
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const machine = await createMachine(pool, org.id, 'github-actions', hashedToken, expiresAt);
    assert.equal(machine.name, 'github-actions');
    assert.deepEqual(machine.roles, ['machine']);
    assert.equal(machine.revokedAt, null);

    const found = await findMachineByHashedToken(pool, hashedToken);
    assert.equal(found?.id, machine.id);

    const listed = await listMachinesByOrg(pool, org.id);
    assert.equal(listed.length, 1);

    await revokeMachine(pool, machine.id);
    const afterRevoke = await listMachinesByOrg(pool, org.id);
    assert.equal(afterRevoke.length, 0); // listMachinesByOrg filters out revoked machines
  });

  await pool.end();
});
