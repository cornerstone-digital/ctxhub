/**
 * ctxhub Cloud — Postgres client and query helpers for schema.sql.
 *
 * Closes the "Organisation and member identity" roadmap item (organisations, members,
 * workspaces, machines tables). The Cloud service itself is not deployed anywhere yet
 * (see service.ts's doc comment) — this module has only been run against a local,
 * ephemeral Postgres 17 container, never against a real Railway/production instance
 * or under concurrent load. Treat as validated-in-shape, not production-hardened:
 * connection pooling behaviour, migration ordering against an existing populated
 * database, and failover all still need real integration testing before this backs
 * a live deployment.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPool(config: PoolConfig): Pool {
  return new Pool(config);
}

/** Applies schema.sql in full. Idempotent only in the sense that CREATE TABLE will
 * fail loudly on a database that already has these tables -- there is no migration
 * versioning yet (see "Still needed" in ROADMAP.md M6). Intended for a fresh database. */
export async function applySchema(pool: Pool): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
}

// ── organisations ────────────────────────────────────────────────────────────

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  entraTenantId: string | null;
  createdAt: string;
}

function rowToOrg(row: Record<string, unknown>): OrgRow {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    entraTenantId: (row.entra_tenant_id as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createOrg(pool: Pool, name: string, slug: string, entraTenantId?: string): Promise<OrgRow> {
  const result = await pool.query(
    `INSERT INTO organisations (name, slug, entra_tenant_id) VALUES ($1, $2, $3) RETURNING *`,
    [name, slug, entraTenantId ?? null]
  );
  return rowToOrg(result.rows[0]);
}

export async function findOrgBySlug(pool: Pool, slug: string): Promise<OrgRow | undefined> {
  const result = await pool.query(`SELECT * FROM organisations WHERE slug = $1`, [slug]);
  return result.rows[0] ? rowToOrg(result.rows[0]) : undefined;
}

// ── members ───────────────────────────────────────────────────────────────────

export interface MemberRow {
  id: string;
  orgId: string;
  entraSub: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
}

function rowToMember(row: Record<string, unknown>): MemberRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    entraSub: row.entra_sub as string,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    role: row.role as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createMember(
  pool: Pool,
  orgId: string,
  entraSub: string,
  email: string,
  name?: string,
  role = 'member'
): Promise<MemberRow> {
  const result = await pool.query(
    `INSERT INTO members (org_id, entra_sub, email, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orgId, entraSub, email, name ?? null, role]
  );
  return rowToMember(result.rows[0]);
}

export async function listMembersByOrg(pool: Pool, orgId: string): Promise<MemberRow[]> {
  const result = await pool.query(`SELECT * FROM members WHERE org_id = $1 ORDER BY created_at`, [orgId]);
  return result.rows.map(rowToMember);
}

// ── workspaces ────────────────────────────────────────────────────────────────

export interface WorkspaceRow {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    slug: row.slug as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createWorkspace(pool: Pool, orgId: string, name: string, slug: string): Promise<WorkspaceRow> {
  const result = await pool.query(
    `INSERT INTO workspaces (org_id, name, slug) VALUES ($1, $2, $3) RETURNING *`,
    [orgId, name, slug]
  );
  return rowToWorkspace(result.rows[0]);
}

export async function listWorkspacesByOrg(pool: Pool, orgId: string): Promise<WorkspaceRow[]> {
  const result = await pool.query(`SELECT * FROM workspaces WHERE org_id = $1 ORDER BY created_at`, [orgId]);
  return result.rows.map(rowToWorkspace);
}

// ── machines ──────────────────────────────────────────────────────────────────

export interface MachineRow {
  id: string;
  orgId: string;
  name: string;
  hashedToken: string;
  roles: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function rowToMachine(row: Record<string, unknown>): MachineRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    hashedToken: row.hashed_token as string,
    roles: row.roles as string[],
    createdAt: (row.created_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : null,
    revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
  };
}

export async function createMachine(
  pool: Pool,
  orgId: string,
  name: string,
  hashedToken: string,
  expiresAt: Date,
  roles: string[] = ['machine']
): Promise<MachineRow> {
  const result = await pool.query(
    `INSERT INTO machines (org_id, name, hashed_token, roles, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orgId, name, hashedToken, roles, expiresAt.toISOString()]
  );
  return rowToMachine(result.rows[0]);
}

export async function findMachineByHashedToken(pool: Pool, hashedToken: string): Promise<MachineRow | undefined> {
  const result = await pool.query(`SELECT * FROM machines WHERE hashed_token = $1`, [hashedToken]);
  return result.rows[0] ? rowToMachine(result.rows[0]) : undefined;
}

export async function listMachinesByOrg(pool: Pool, orgId: string): Promise<MachineRow[]> {
  const result = await pool.query(
    `SELECT * FROM machines WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [orgId]
  );
  return result.rows.map(rowToMachine);
}

export async function revokeMachine(pool: Pool, id: string): Promise<void> {
  await pool.query(`UPDATE machines SET revoked_at = NOW() WHERE id = $1`, [id]);
}
