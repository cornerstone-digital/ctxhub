# ctxhub Cloud

ctxhub Cloud is the managed multi-tenant coordination layer that sits on top of self-hosted ctxhub instances. It does not replace self-hosted instances — they continue to own and serve their own data. Cloud adds the cross-org visibility, managed embeddings, and shared Mission Control that multiple self-hosted instances need to coordinate.

## What it adds

- **Cross-org discovery** — orgs in the same corporate group can discover each other's promoted knowledge without manual peer URL configuration.
- **Managed embeddings** — cloud re-embeds promoted chunks using a consistent model so semantic search works across workspaces and orgs without per-instance GPU or API key setup.
- **Cloud Mission Control** — a read-only, aggregated view of captain runs and promoted findings across all workspaces in an org or corporate group. Historical only; self-hosted instances remain the source of truth.
- **Share token registry** — context pack share tokens are optionally registered in Cloud so they survive service restarts and can be audited.

## What it is not

Cloud is **not** an autonomous agent, a coding assistant, or a replacement for self-hosted instances. Self-hosted instances still own their data. Cloud is a read-only replica of promoted, explicitly shared knowledge — nothing is sent to Cloud without an explicit `ctxhub sync --to-cloud` or equivalent push.

## How sync works

1. Engineers run `ctxhub chunk promote --tier institutional` locally to elevate a chunk's trust tier.
2. Running `ctxhub sync --to-cloud` pushes chunks at `institutional` or `canonical` trust tier to the configured Cloud endpoint (`CTXHUB_CLOUD_ENDPOINT`).
3. Cloud ingests the chunks, deduplicates by `content_hash`, stores embeddings, and makes them available for federation search.
4. `GET /peers` on a self-hosted instance returns active peers (seen within 5 minutes via heartbeat) for direct fan-out; Cloud extends this to peers that are not always-on.

See `src/cloud/sync.ts` for the sync client stub and `src/cloud/schema.sql` for the Postgres schema.

## Tech stack

- **Runtime**: Node.js (TypeScript), same toolchain as self-hosted ctxhub
- **Database**: PostgreSQL with pgvector for vector search (bytea fallback until pgvector is available)
- **Job queue**: Redis (BullMQ) for embedding jobs and async sync ingestion
- **Auth**: Microsoft Entra ID OIDC, same flow as self-hosted (`src/auth/`)
- **Deployment**: Docker Compose (dev), Kubernetes + Helm (production)

## Schema

See `src/cloud/schema.sql`. Tables:

| Table | Purpose |
|---|---|
| `organisations` | Legal entities subscribed to ctxhub Cloud |
| `workspaces` | Project-scoped namespaces within an org |
| `members` | Org users, populated from Entra ID at login |
| `chunks` | Promoted chunks synced from self-hosted instances |
| `chunk_embeddings` | Per-model vector embeddings for semantic search |
| `sync_cursors` | Incremental sync state per workspace |
| `corporate_groups` | Cloud-side mirror of the corporate groups model |
| `group_memberships` | Org membership with trust tier and sharing mode |
| `share_tokens` | One-time / time-limited context pack share URLs |
| `audit_log` | Immutable append-only security event log |
