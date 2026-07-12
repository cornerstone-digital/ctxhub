-- ctxhub Cloud — Postgres schema
-- Managed multi-tenant cloud layer on top of self-hosted ctxhub instances.
-- Self-hosted instances push promoted chunks to cloud; cloud handles federation and Mission Control.
--
-- Conventions:
--   * All primary keys are UUIDs (gen_random_uuid()).
--   * All timestamps are timestamptz stored in UTC.
--   * Soft deletes are not used; records are hard-deleted or archived in audit_log.

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
-- Uncomment when pgvector is available on the target cluster:
-- CREATE EXTENSION IF NOT EXISTS "vector";

-- ── organisations ─────────────────────────────────────────────────────────────
-- A legal entity that subscribes to ctxhub Cloud.
-- Maps 1-to-1 with a Microsoft Entra ID tenant.

CREATE TABLE organisations (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT        NOT NULL,
    slug             TEXT        NOT NULL UNIQUE,          -- URL-safe identifier, e.g. "vodafone-uk"
    entra_tenant_id  TEXT        UNIQUE,                   -- Entra directory (tenant) ID; NULL for non-Entra orgs
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  organisations IS 'Legal entities subscribed to ctxhub Cloud; one per Entra tenant.';
COMMENT ON COLUMN organisations.slug IS 'URL-safe unique identifier used in API paths and UI.';
COMMENT ON COLUMN organisations.entra_tenant_id IS 'Microsoft Entra tenant ID; used for SSO and cross-org trust resolution.';

CREATE INDEX idx_organisations_slug            ON organisations (slug);
CREATE INDEX idx_organisations_entra_tenant_id ON organisations (entra_tenant_id) WHERE entra_tenant_id IS NOT NULL;

-- ── workspaces ────────────────────────────────────────────────────────────────
-- A project-scoped namespace within an org. Corresponds to a self-hosted ctxhub workspace.

CREATE TABLE workspaces (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL,                      -- unique within the org
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, slug)
);

COMMENT ON TABLE  workspaces IS 'Project-scoped knowledge namespace; one ctxhub workspace per record.';
COMMENT ON COLUMN workspaces.slug IS 'URL-safe identifier, unique within the org.';

CREATE INDEX idx_workspaces_org_id ON workspaces (org_id);

-- ── members ───────────────────────────────────────────────────────────────────
-- Users who belong to an org. Populated from Entra ID at login; role is derived from
-- the Entra group → ctxhub role mapping stored in auth.json on the self-hosted side.

CREATE TABLE members (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
    entra_sub   TEXT        NOT NULL,                      -- Entra object ID (sub claim)
    email       TEXT        NOT NULL,
    name        TEXT,
    role        TEXT        NOT NULL DEFAULT 'member',     -- owner | admin | member | viewer
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, entra_sub)
);

COMMENT ON TABLE  members IS 'Org members; populated from Entra ID at login time.';
COMMENT ON COLUMN members.entra_sub IS 'Entra object ID (sub JWT claim); immutable user identifier.';
COMMENT ON COLUMN members.role IS 'ctxhub role: owner | admin | member | viewer.';

CREATE INDEX idx_members_org_id    ON members (org_id);
CREATE INDEX idx_members_entra_sub ON members (entra_sub);

-- ── machines ──────────────────────────────────────────────────────────────────
-- Cloud-side mirror of a self-hosted instance's machine tokens (src/auth/machineTokenStore.ts).
-- One row per `ctxm_`-prefixed token issued by `ctxhub machine-token create`; lets Cloud
-- authenticate and audit sync traffic from a specific self-hosted machine.

CREATE TABLE machines (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,                     -- human label, e.g. "github-actions"
    hashed_token   TEXT        NOT NULL UNIQUE,               -- scrypt hash; format matches machineTokenStore.ts
    roles          TEXT[]      NOT NULL DEFAULT ARRAY['machine'],
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL,
    last_used_at   TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ
);

COMMENT ON TABLE  machines IS 'Cloud-side record of self-hosted machine tokens; mirrors machineTokenStore.ts.';
COMMENT ON COLUMN machines.hashed_token IS 'scrypt hash of the raw ctxm_ token; same format as the local JSON store.';
COMMENT ON COLUMN machines.roles IS 'ctxhub roles granted to this machine, e.g. {machine}.';

CREATE INDEX idx_machines_org_id ON machines (org_id);
CREATE INDEX idx_machines_expires_at ON machines (expires_at);

-- ── chunks ────────────────────────────────────────────────────────────────────
-- Promoted knowledge chunks synced from self-hosted instances.
-- Only chunks at trust tier institutional or canonical are synced (ADR-009).

CREATE TABLE chunks (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    content_hash   TEXT        NOT NULL,                   -- sha256 of body; used for deduplication
    title          TEXT,
    body           TEXT        NOT NULL,
    trust_tier     TEXT        NOT NULL DEFAULT 'institutional',  -- institutional | canonical
    source_path    TEXT,                                   -- relative file path in the source repo
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_at    TIMESTAMPTZ,                            -- when the chunk was promoted on the self-hosted side
    UNIQUE (workspace_id, content_hash)
);

COMMENT ON TABLE  chunks IS 'Promoted knowledge chunks synced from self-hosted ctxhub instances.';
COMMENT ON COLUMN chunks.content_hash IS 'SHA-256 of body text; prevents duplicate ingestion within a workspace.';
COMMENT ON COLUMN chunks.trust_tier IS 'Only institutional and canonical chunks are synced to Cloud.';
COMMENT ON COLUMN chunks.source_path IS 'Relative path of the source file in the origin repo, for traceability.';

CREATE INDEX idx_chunks_workspace_id  ON chunks (workspace_id);
CREATE INDEX idx_chunks_content_hash  ON chunks (content_hash);
CREATE INDEX idx_chunks_trust_tier    ON chunks (trust_tier);
CREATE INDEX idx_chunks_promoted_at   ON chunks (promoted_at) WHERE promoted_at IS NOT NULL;

-- ── chunk_embeddings ──────────────────────────────────────────────────────────
-- Vector embeddings for semantic search. One row per chunk per embedding model.
-- Vector stored as bytea for portability; migrate to pgvector's vector type when available.

CREATE TABLE chunk_embeddings (
    chunk_id    UUID        NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    model       TEXT        NOT NULL,                      -- e.g. "text-embedding-3-small"
    vector      BYTEA       NOT NULL,                      -- float32[] serialised as little-endian bytes
    -- When pgvector is available, replace the line above with:
    -- vector      vector(1536) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chunk_id, model)
);

COMMENT ON TABLE  chunk_embeddings IS 'Per-model vector embeddings for semantic search over promoted chunks.';
COMMENT ON COLUMN chunk_embeddings.vector IS 'Float32 embedding vector; migrate to pgvector vector type when available.';

CREATE INDEX idx_chunk_embeddings_model ON chunk_embeddings (model);

-- ── sync_cursors ──────────────────────────────────────────────────────────────
-- Tracks the last successful sync from each self-hosted workspace so incremental
-- syncs can resume where they left off without re-sending every chunk.

CREATE TABLE sync_cursors (
    workspace_id     UUID        PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    last_synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_chunk_hash  TEXT                                  -- content_hash of the most recently synced chunk
);

COMMENT ON TABLE  sync_cursors IS 'Sync state per workspace; enables incremental push from self-hosted instances.';

-- ── corporate_groups ─────────────────────────────────────────────────────────
-- Cloud-side mirror of the self-hosted corporate groups model (src/groups/types.ts).
-- Orgs in the same group share knowledge under controlled conditions.

CREATE TABLE corporate_groups (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE corporate_groups IS 'Cloud-side corporate group; maps to a CorporateGroup on self-hosted instances.';

-- ── group_memberships ─────────────────────────────────────────────────────────
-- Joins orgs to corporate groups with a trust tier and sharing mode.

CREATE TABLE group_memberships (
    group_id      UUID        NOT NULL REFERENCES corporate_groups (id) ON DELETE CASCADE,
    org_id        UUID        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
    trust_tier    TEXT        NOT NULL DEFAULT 'participant',  -- observer | participant | trusted
    sharing_mode  TEXT        NOT NULL DEFAULT 'none',         -- none | read | bidirectional
    joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, org_id)
);

COMMENT ON TABLE  group_memberships IS 'Org membership in a corporate group with trust and sharing configuration.';
COMMENT ON COLUMN group_memberships.trust_tier IS 'observer | participant | trusted — controls cross-org data visibility.';
COMMENT ON COLUMN group_memberships.sharing_mode IS 'none | read | bidirectional — controls what the org exposes to peers.';

CREATE INDEX idx_group_memberships_org_id ON group_memberships (org_id);

-- ── share_tokens ──────────────────────────────────────────────────────────────
-- One-time or time-limited URLs for sharing context packs between ctxhub instances.
-- Corresponds to the share token issued by `ctxhub share` (src/commands/share.ts).

CREATE TABLE share_tokens (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_workspace_id UUID      NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    query                 TEXT        NOT NULL,             -- the search query that produced the pack
    pack_hash             TEXT        NOT NULL,             -- sha256 of the context pack JSON
    expires_at            TIMESTAMPTZ NOT NULL,
    used_at               TIMESTAMPTZ,                      -- set when served (for one-time tokens)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  share_tokens IS 'Short-lived signed URLs for sharing context packs; mirrors the local share model.';
COMMENT ON COLUMN share_tokens.pack_hash IS 'SHA-256 of the context pack JSON; used for integrity verification.';
COMMENT ON COLUMN share_tokens.used_at IS 'Set on first access for one-time tokens; NULL means not yet consumed.';

CREATE INDEX idx_share_tokens_workspace_id ON share_tokens (created_by_workspace_id);
CREATE INDEX idx_share_tokens_expires_at   ON share_tokens (expires_at);

-- ── audit_log ─────────────────────────────────────────────────────────────────
-- Immutable append-only log of security-relevant events. Never updated or deleted.

CREATE TABLE audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        REFERENCES organisations (id) ON DELETE SET NULL,
    workspace_id  UUID        REFERENCES workspaces (id) ON DELETE SET NULL,
    actor_sub     TEXT,                                     -- Entra sub of the acting user (NULL for system events)
    event_type    TEXT        NOT NULL,                     -- e.g. 'chunk.synced', 'share.served', 'member.added'
    payload       JSONB       NOT NULL DEFAULT '{}',        -- event-specific details
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  audit_log IS 'Immutable security audit log; append-only, never updated or deleted.';
COMMENT ON COLUMN audit_log.event_type IS 'Dot-namespaced event type, e.g. chunk.synced, share.served, member.added.';
COMMENT ON COLUMN audit_log.payload IS 'Event-specific JSON payload for additional context.';

-- Partition by month in production for query performance on large deployments.
-- For the MVP, a plain table with indexes is sufficient.
CREATE INDEX idx_audit_log_org_id       ON audit_log (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX idx_audit_log_workspace_id ON audit_log (workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX idx_audit_log_actor_sub    ON audit_log (actor_sub) WHERE actor_sub IS NOT NULL;
CREATE INDEX idx_audit_log_event_type   ON audit_log (event_type);
CREATE INDEX idx_audit_log_created_at   ON audit_log (created_at);
