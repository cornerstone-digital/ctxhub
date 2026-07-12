# Evidence Sources Architecture

**Status:** Migration steps 1–3 implemented. See [ADR-020](adr/ADR-020-evidence-sources-not-repositories.md) for the decision this document elaborates.

## Why this document exists

[ADR-020](adr/ADR-020-evidence-sources-not-repositories.md) decides that a workspace's root concept is Evidence Sources, not Repositories. This document works out what that actually looks like: the adapter contract, how it relates to the `WorkspaceAdapter` pattern already designed for M17 (`docs/monorepo_architecture.md`), what changes at each layer of the existing codebase, and — explicitly — what is not decided or built yet.

Git remains the default, most-used adapter throughout; per ADR-020's constraint, nothing about existing git-workspace behavior regressed (the full indexer test suite passes unchanged, plus new coverage for the extracted adapter).

**One invariant this whole design rests on:** Evidence Sources never create Knowledge Objects directly. They contribute evidence from which candidate knowledge may be derived, reviewed and promoted. No adapter, however trusted its origin feels, gets to skip that path — that's what keeps ADR-008's trust model intact as new source kinds are added.

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

**Built:**

```
Workspace
  ├── repositories: RepoConfig[]                 (unchanged, git)
  └── evidenceSources?: EvidenceSourceConfig[]    (additive: non-git adapters)
        └── indexWorkspace() loops over one EvidenceSource per repo/source
              └── Evidence (raw, untrusted, adapter-specific shape)
                    └── review / promotion (ADR-008)
                          └── Knowledge Objects, Topology Graph  (unchanged)
```

The important thing this diagram is meant to make obvious: **Knowledge Objects and the Topology Graph do not move.** `docs/platform_runtime_architecture.md` §6 already established they have no repository-specific fields. This change is entirely upstream of them — it's about what feeds ingestion, not what ingestion produces.

`evidenceSources` turned out fully additive rather than a replacement for `repositories` — no compatibility shim needed, because nothing is deprecated. `RepoConfig`/`repositories:` keeps its exact existing shape and meaning; `evidenceSources` is where non-git adapter configs land. This is a smaller, safer change than the original design sketch below proposed, and it's what's actually in `src/config/types.ts` today.

## The `EvidenceSource` adapter contract

Same shape as `WorkspaceAdapter` (`docs/monorepo_architecture.md`), because it's the same problem: detect a source, read its own structure, produce one canonical model. As built (`src/indexing/evidenceSource.ts`):

```ts
interface EvidenceSource {
  kind: string;   // 'git', 'land-registry'
  name: string;   // the configured source's display/manifest name

  /** Cheap reachability/existence check. */
  detect(): Promise<boolean>;

  /** `total` must be known before any item streams, so progress reporting has an accurate
   *  denominator from the start -- the same guarantee git indexing always made. Every
   *  adapter already knows its candidate count cheaply before reading content (a file
   *  listing, a parsed-and-filtered row set), so this isn't a git-only ask. */
  fetch(): Promise<{ total: number; items: AsyncIterable<Evidence> }>;
}

type Evidence = {
  sourceId: string;                    // adapter-specific: file path, transaction id, ...
  content: string;                     // normalised text content
  metadata: Record<string, unknown>;   // adapter-specific: absolute path, commit, price, ...
  /** Set when the adapter found this item but couldn't read it (oversized file, a fetch
   *  failure for one record). indexer.ts skips it without hashing/chunking, but still marks
   *  its manifest key as seen so stale-cleanup doesn't delete a previously-indexed item just
   *  because it became unreadable on this run. */
  unreadable?: string;
};
```

Two deviations from the original design sketch, made while actually building this:

- **No `affectedEvidence()`.** The original sketch proposed a method for webhook-driven incremental re-ingestion. Nothing in `indexWorkspace` does that today — its existing per-item content-hash diff against the manifest is what makes reindexing incremental, not an affected-paths mechanism. Adding an interface method nothing calls would have been speculative; it can come back if/when webhook-triggered incremental indexing is actually built.
- **`fetch()` returns a known `total` up front**, not a bare `AsyncIterable`. This was forced by two pre-existing indexer tests: git indexing has always emitted an immediate, accurate `repo-progress` event with the real file count before scanning starts. A bare async-iterable contract couldn't express that without either double-walking a source or degrading progress to "unknown," so the contract grew a `total` instead. Every adapter already knows its item count cheaply before reading content — a `fast-glob` listing, a parsed-and-filtered CSV row set — so this isn't secretly re-privileging git.

`Evidence` is deliberately thin and untrusted — it carries no confidence score. It is not a `KnowledgeObject`. Turning evidence into a `KnowledgeObject` still goes through the same review/promotion path ADR-008 already defines; this contract only changes what feeds that path.

`RepoConfig` remains the config shape for git, unchanged. `GitEvidenceSource` (`src/indexing/evidenceSources/gitEvidenceSource.ts`) wraps it — a pure extraction of the fast-glob walk and per-file read `indexWorkspace` always did directly.

## What changed at each layer

- **`src/indexing/evidenceSource.ts`** (new): the `Evidence`/`EvidenceSource` contract above.
- **`src/indexing/evidenceSources/gitEvidenceSource.ts`** (new): `GitEvidenceSource` — the extracted fast-glob walk, unchanged behavior, same size guard and commit-stamping.
- **`src/indexing/evidenceSources/landRegistryEvidenceSource.ts`** (new): `LandRegistryEvidenceSource` — the second real adapter (see below).
- **`src/indexing/evidenceSources/index.ts`** (new): `createEvidenceSource`, mirroring `createIndexProvider`'s (`src/indexing/providers.ts`) switch-on-kind factory shape.
- **Indexing package (`src/indexing/indexer.ts`)**: `indexWorkspace` builds one combined adapter list — a `GitEvidenceSource` per `config.repositories[]` entry plus one adapter per `config.evidenceSources[]` entry — and loops over `source.fetch()` uniformly. The per-item pipeline (hash vs. manifest, redact, chunk, trust-tier detection, LLM summary, commit-phase index write) is unchanged, just keyed by `evidence.sourceId`/`evidence.content` instead of `filePath`/file-read content. A source-level fetch failure (e.g. a network blip) is caught per-source and logs a warning rather than aborting the whole run — the previous single-block-loop meant one bad repo could take the entire index down; that's no longer true for either kind. `src/indexing/` keeps its name for now — worth revisiting once ingestion covers more than two adapters, not before.
- **Config schema (`src/config/types.ts`, `src/config/defaultConfig.ts`, `src/config/config.ts`)**: `CtxhubConfig.evidenceSources?: EvidenceSourceConfig[]` added additively, defaulted to `[]` the same way `repositories` already is. `repositories: RepoConfig[]` is untouched.
- **CLI (`src/commands/source.ts`, registered in `src/cli/program.ts`)**: `ctxhub source add-land-registry <name> --area <outcode> [--since <date>]` and `ctxhub source list` (shows repositories and evidence sources together). Kept as its own top-level `source` command family rather than folded into `repo` — git's `add`/`discover`/`hook` subcommands all assume a local checkout, which no other adapter kind has, so merging them didn't make sense once actually building it. Whether this changes later is still an open UX question.
- **Not touched, deliberately deferred**: Mission Control UI still only shows repositories; blueprint manifests; any rename of `src/indexing/`. These are still real work, gated on an actual UI/product need rather than done speculatively alongside this pass.

## The second adapter: UK Land Registry Price Paid Data

Built against the real, live, unauthenticated HM Land Registry Price Paid Data monthly-update CSV (`https://price-paid-data.publicdata.landregistry.gov.uk/pp-monthly-update-new-version.csv`, Open Government Licence v3.0, confirmed live and its column layout verified against a byte-range fetch of the real file while building this — no header row, 16 fixed columns: transaction id, price, date of transfer, postcode, property type, new-build flag, tenure, PAON, SAON, street, locality, town, district, county, PPD category, record status). Filters to a configured postcode outcode and a since-date (default: last 12 months), skips withdrawn/deleted records, and turns each remaining transaction into one `Evidence` item — a plain-English comparable-sale summary as `content`, structured fields (`price`, `postcode`, `propertyType`, `duration`, `newBuild`) as `metadata`. Every field name and the monthly-vs-complete-file choice was confirmed against a working prior implementation in the sibling `property-deal-engine` repo rather than guessed.

This proves the abstraction end-to-end: a completely non-file, non-git source flows through the exact same `indexWorkspace` pipeline as a git repo, lands in the index as `unverified` trust-tier evidence (same default as any freshly-indexed content — no source gets a trust head start), and is searchable immediately.

## What this document does not decide

- Whether Rightmove or Planning Portal adapters are worth building. Neither has a workable open API today (Rightmove has no public third-party API and scraping violates their ToS; Planning Portal access varies by council with no unified API) — a business-development relationship would be needed first, which is a product/BD decision, not an architecture one.
- Whether Confluence/Notion (engineering-side BYOK, `docs/future_primitives_brainstorm.md`) becomes a third adapter, and when.
- Any UX for how a user configures multiple evidence sources of the same kind, or how conflicts between sources are surfaced.
- Mission Control UI changes, the `src/commands/repo.ts` vs `src/commands/source.ts` command-family question, or any `src/indexing/` rename.
- A ROADMAP milestone. This was built as a proof of the abstraction, not a scheduled product feature.

## Related

- [ADR-020 — Evidence Sources, not Repositories, are the workspace's root concept](adr/ADR-020-evidence-sources-not-repositories.md)
- [ADR-008 — Confidence scores are organisational, not model-generated](adr/ADR-008-confidence-is-organisational.md) — the trust mechanism Evidence feeds into once promoted to Knowledge
- `docs/platform_runtime_architecture.md` §6 — the finding that Knowledge Objects and the Topology Graph are already domain-agnostic, which is what makes this an input-side-only change
- `docs/monorepo_architecture.md` — the `WorkspaceAdapter` pattern this document's `EvidenceSource` contract is modeled on
- `docs/future_primitives_brainstorm.md` — BYOK, which this reframes as "another Evidence Source adapter" rather than a separate future feature
