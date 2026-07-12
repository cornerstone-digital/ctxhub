# Evidence Sources Architecture

**Status:** Design target, not yet implemented. See [ADR-020](adr/ADR-020-evidence-sources-not-repositories.md) for the decision this document elaborates.

## Why this document exists

[ADR-020](adr/ADR-020-evidence-sources-not-repositories.md) decides that a workspace's root concept is Evidence Sources, not Repositories. This document works out what that actually looks like: the adapter contract, how it relates to the `WorkspaceAdapter` pattern already designed for M17 (`docs/monorepo_architecture.md`), what changes at each layer of the existing codebase, and — explicitly — what is not being decided or built yet.

This is a design document, not a migration plan with a start date. Per ADR-020's constraint, git keeps working exactly as it does today until this is actually built, and it isn't built by this document.

## The model, before and after

**Today:**

```
Workspace
  └── repositories: RepoConfig[]      (git repos, hardcoded)
        └── indexWorkspace() walks each repo's files
              └── IndexedDocument (repo, filePath, absolutePath)
                    └── Knowledge Objects, Topology Graph
```

`repositories` is the workspace's only registered kind of "thing to look at." Everything downstream — the indexer, the `repo` command family, Mission Control's source list — assumes that thing is a directory with source files and maybe a `.git` folder.

**Target:**

```
Workspace
  └── evidenceSources: EvidenceSourceConfig[]   (git is one kind, not the only kind)
        └── ingest() over whichever adapters are registered
              └── Evidence (raw, untrusted, adapter-specific shape)
                    └── review / promotion (ADR-008)
                          └── Knowledge Objects, Topology Graph  (unchanged)
```

The important thing this diagram is meant to make obvious: **Knowledge Objects and the Topology Graph do not move.** `docs/platform_runtime_architecture.md` §6 already established they have no repository-specific fields. This change is entirely upstream of them — it's about what feeds ingestion, not what ingestion produces.

## The `EvidenceSource` adapter contract

Same shape as `WorkspaceAdapter` (`docs/monorepo_architecture.md`), because it's the same problem: detect a source, read its own structure, produce one canonical model.

```ts
interface EvidenceSource {
  /** Stable identifier for this adapter kind, e.g. 'git', 'confluence', 'land-registry'. */
  kind: string;

  /** Cheap check: is this source configured/reachable? */
  detect(config: EvidenceSourceConfig): Promise<boolean>;

  /** Pull raw evidence from the source. Adapter-specific — a git adapter walks files,
   *  a Confluence adapter paginates the REST API, a feed adapter fetches and diffs. */
  fetch(config: EvidenceSourceConfig): AsyncIterable<Evidence>;

  /** Given a change notification (webhook, file watch, poll diff), return the evidence
   *  IDs affected — used for incremental re-ingestion. Falls back to "everything". */
  affectedEvidence(config: EvidenceSourceConfig, change: unknown): Promise<string[]>;
}

interface Evidence {
  sourceKind: string;           // 'git', 'confluence', ...
  sourceId: string;             // adapter-specific: file path, page ID, record ID
  content: string;              // normalised text content
  metadata: Record<string, unknown>;  // adapter-specific: author, timestamp, URL, etc.
}
```

`Evidence` is deliberately thin and untrusted — it carries no confidence score. It is not a `KnowledgeObject`. Turning evidence into a `KnowledgeObject` still goes through the same review/promotion path ADR-008 already defines; this contract only changes what feeds that path.

`RepoConfig` becomes the config shape for the `kind: 'git'` adapter. It does not go away — it's what the git adapter's `EvidenceSourceConfig` looks like.

## What changes at each layer

Ordered roughly by how far each layer is from the actual abstraction boundary, and how large the change is:

- **Indexing package (`src/indexing/`)**: `indexWorkspace`'s `for (const repo of config.repositories)` loop becomes `for (const source of registeredAdapters)`. This is the core of the change and the reason ADR-020 calls the migration cost real, not cosmetic. The package's framing shifts from "repository indexing" to "knowledge ingestion" — worth a rename once the migration lands, not before.
- **Config schema (`src/config/types.ts`)**: `CtxhubConfig.repositories: RepoConfig[]` becomes `evidenceSources: EvidenceSourceConfig[]`, with `RepoConfig` as the `git`-kind variant. This is a breaking schema change for existing `ctxhub.config` files, so it needs a compatibility shim (read old `repositories:` as implicit `kind: 'git'` sources) rather than a hard cutover — consistent with the "nothing regresses" constraint in ADR-020.
- **`ctxhub repo` command family (`src/commands/repo.ts`)**: becomes the `git` adapter's command surface. Whether the CLI keeps `ctxhub repo add` as a git-specific shorthand alongside a more general `ctxhub source add --kind git` is an open UX question, not resolved here.
- **Mission Control UI**: today's "Repositories" list becomes an "Evidence Sources" list, grouped or filtered by kind. No architectural change to Mission Control itself — it already renders whatever it's given (`docs/platform_runtime_architecture.md` §7's "Mission Control doesn't care" point applies here too).
- **Blueprint manifests**: any manifest field that assumes `repositories` needs the same schema widening as the config type.

Roughly 26 files reference `config.repositories` directly today (per a repo-wide grep at the time ADR-020 was written) — that's the honest surface area of "layer" above, not a number to be revisited lightly.

## Migration path

Not a big-bang rewrite. In order:

1. Introduce `EvidenceSource`/`EvidenceSourceConfig` as new types, with a `git` adapter that wraps today's `RepoConfig` behavior exactly. `repositories:` in config keeps working, read as implicit git sources. No user-visible change.
2. Point `indexWorkspace` at the adapter registry instead of `config.repositories` directly, with only the `git` adapter registered. Still no user-visible change — this is the risky step (touches the indexer directly) but should be behaviorally invisible if done right.
3. Build a second real adapter — Confluence is the most likely first candidate given existing BYOK interest (`docs/future_primitives_brainstorm.md`). This is the actual validation step: the abstraction is only proven once something other than git flows through it end-to-end.
4. Only after step 3 succeeds: widen the CLI, Mission Control UI, and config schema's public shape to first-class "evidence source," and consider the `src/indexing/` → ingestion rename.

Steps 1–2 are plumbing and are cheap. Step 3 is the actual test of whether this abstraction is correctly shaped — per ADR-020's own stated risk, building past step 2 before a second adapter is proven is the same premature-generalization mistake ADR-009 and ADR-013 already warn against elsewhere. **Nothing here is scheduled.** This becomes real when there's a concrete second Evidence Source to build against — either a DealLedger ingestion need or a customer BYOK request — not before.

## What this document does not decide

- Whether DealLedger's property-data adapters (Land Registry, Rightmove, Planning Portal) are the second adapter that proves this, or whether Confluence/Notion (engineering-side BYOK) comes first. That's a product sequencing call, not an architecture one.
- Any UX for how a user configures multiple evidence sources of the same kind, or how conflicts between sources are surfaced.
- Whether `src/indexing/` is actually renamed, and when — cosmetic, deferred until the package's behavior has actually changed.
- A ROADMAP milestone or timeline. This stays a design document until a trigger (per ADR-013's pattern) makes it one.

## Related

- [ADR-020 — Evidence Sources, not Repositories, are the workspace's root concept](adr/ADR-020-evidence-sources-not-repositories.md)
- [ADR-008 — Confidence scores are organisational, not model-generated](adr/ADR-008-confidence-is-organisational.md) — the trust mechanism Evidence feeds into once promoted to Knowledge
- `docs/platform_runtime_architecture.md` §6 — the finding that Knowledge Objects and the Topology Graph are already domain-agnostic, which is what makes this an input-side-only change
- `docs/monorepo_architecture.md` — the `WorkspaceAdapter` pattern this document's `EvidenceSource` contract is modeled on
- `docs/future_primitives_brainstorm.md` — BYOK, which this reframes as "another Evidence Source adapter" rather than a separate future feature
