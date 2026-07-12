# ADR-020 — Evidence Sources, not Repositories, are the workspace's root concept

**Date:** July 2026
**Status:** Accepted

## Context

ctxhub's config schema and indexing pipeline treat `repositories: RepoConfig[]` as a workspace's primary contents. `ctxhub init`, the whole `repo` command family, the indexer (`indexWorkspace` iterates `config.repositories` directly), and Mission Control's UI all assume "the things in a workspace are git repositories." That assumption predates the Org Graph, the Trust Model, and the Platform Runtime exploration (`docs/platform_runtime_architecture.md`), and it no longer matches what's actually been designed.

`docs/platform_runtime_architecture.md` §6 found that `KnowledgeObject` and the Topology Graph already have no repository-specific fields — they're domain-agnostic today. What's still hardcoded is the *input* side: what a workspace ingests from. A git repository is not fundamentally different from Confluence, a database export, an S3 bucket of PDFs, Slack, Jira, or a property-listing feed — all of them are places evidence lives, not knowledge itself. Calling them all "repositories," or even "knowledge sources," obscures that distinction. A git commit, a Confluence page, and a Datadog alert carry no trust on their own — they're raw material. A Knowledge Object derived from *reviewing* that material is what earns trust, through the same corroboration/promotion mechanism [ADR-008](ADR-008-confidence-is-organisational.md) already defines. This ADR doesn't change ADR-008's model; it names what sits on the input side of it correctly.

## Decision

**A workspace's root concept is Evidence Sources, not Repositories. A git repository becomes the first implementation of an `EvidenceSource` adapter — a peer of a future Confluence, Notion, or property-feed adapter, not a privileged special case.**

This is the same adapter pattern already designed for M17's `WorkspaceAdapter` (`docs/monorepo_architecture.md`) — detect, read the source's own structure, produce one canonical model — applied to ingestion instead of topology. The indexing pipeline becomes ingestion over whatever `EvidenceSource` adapters are registered for a workspace, not "walk these git repos." No `EvidenceSource` type is privileged in the schema, the indexer, or Mission Control's UI over any other.

Evidence and Knowledge remain distinct stages, matching ADR-008: an `EvidenceSource` produces raw material; ingestion normalises it; a human (or a Captain, subject to the same promotion gate everything else in this codebase already requires) turns some of that material into a `KnowledgeObject`, which is what actually accumulates trust.

## Consequences

**Positive:**
- Brings the input side of the pipeline into alignment with data that was already generic — `KnowledgeObject` and the Topology Graph don't need to change shape for this.
- BYOK (`docs/future_primitives_brainstorm.md`) stops being a separate future idea and becomes "another `EvidenceSource` adapter" — Confluence, Notion, SharePoint adapters are peers of the git adapter from day one of the abstraction existing, not a bolt-on added later.
- Unlocks DealLedger's actual ingestion needs (Land Registry, Rightmove, Planning Portal, uploaded PDFs, investor notes) through the same pipeline, without a second ingestion system.
- `ctxhub init` can eventually ask "what are your evidence sources?" instead of assuming git, without changing what a git-only workspace looks or behaves like today.

**Negative:**
- Real migration cost, not a rename: `config.repositories` is referenced directly across roughly 26 files today (config schema, the `repo` command family, the indexer, Mission Control's UI, blueprint manifests). Each needs the abstraction drawn correctly, not just relabeled.
- Risk of the same premature-abstraction mistake the Platform Runtime doc's own Success Criteria (§11) warns against one layer up — building a general `EvidenceSource` contract before a second real adapter exists to prove it against is speculative generalization from a single case (git), same as [ADR-009](ADR-009-storage-follows-phase-gates.md) and [ADR-013](ADR-013-build-only-when-trigger-fires.md) already warn against elsewhere in this codebase.

**Constraint to preserve:**
Git remains the default, most-used `EvidenceSource` adapter, and nothing about today's `ctxhub init`/`repo add` workflow should regress while this migration happens. The adapter is introduced underneath existing behaviour — git repos keep working exactly as they do today, wrapped by the new abstraction — not built as a parallel system that existing workspaces have to migrate onto. Do not remove or deprecate `RepoConfig`/`repositories:` until a second real `EvidenceSource` adapter exists and is actually used by a real workspace; until then, this ADR describes the target shape, not a completed migration.
