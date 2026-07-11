# ADR-017 — Cloud sync as one-way push of promoted knowledge

**Date:** July 2026  
**Status:** Proposed

## Context

Self-hosted instances can find each other via direct peer heartbeats, but this requires all instances to be addressable and always-on. For asynchronous federation — including instances behind firewalls or with intermittent connectivity — a shared read replica in the Cloud is needed. The design must not require Cloud to access raw files or hold the source of truth.

## Decision

**Self-hosted instances push `institutional` and `canonical` chunks to Cloud. Cloud is a read-only replica for federation search. Self-hosted instances own the source of truth.**

The push protocol (`src/cloud/sync.ts`) is one-directional:
1. `ctxhub sync --to-cloud` reads chunks at `institutional`/`canonical` tier from the local index.
2. A signed `POST /sync` request (Bearer API key) delivers the payload to the Cloud endpoint.
3. Cloud deduplicates by `contentHash` per workspace, stores embeddings, and makes chunks available for `GET /search`.
4. Cloud never pulls from self-hosted instances; self-hosted instances never receive writes from Cloud.

Sync is incremental via a cursor stored in `~/.ctxhub/cloud-cursor.json`.

## Consequences

**Positive:**
- Cloud has no access to raw source files or unverified content — only what operators explicitly push.
- Self-hosted instances remain the source of truth; losing Cloud connectivity does not affect local operation.
- Deduplication by `contentHash` makes sync idempotent; re-pushing is safe.

**Negative:**
- Cross-org Cloud search is only as fresh as the last `sync --to-cloud` run; stale replicas are expected.
- A misconfigured `institutional` tier can inadvertently expose content to Cloud; operator discipline is required.
- Cloud does not backfill deleted chunks; revocation requires a separate `DELETE /sync/:hash` call (not yet implemented).
