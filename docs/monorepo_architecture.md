# ctxhub Monorepo Support
Architecture Design Document — v1
*Status: Draft · July 2026*

## 1. The promise

**"If your repository already understands its own topology, ctxhub should understand it too."**

ctxhub treats monorepos as first-class citizens, not as oversized repositories. It understands projects, packages, applications, libraries, services, ownership boundaries, and dependency relationships out of the box — not by inferring structure from source code alone, but by integrating with the workspace tooling the repository already uses to describe its own topology.

Whether an organisation uses Nx, Turborepo, Bazel, Rush, pnpm Workspaces, Yarn Workspaces, or another build system, ctxhub should feel native rather than bolted on.

## 2. Why this matters

Monorepo tooling already contains valuable engineering knowledge. Dependency graphs, project boundaries, ownership metadata, tags, and build relationships have been carefully curated by engineering teams over years. ctxhub should consume and enrich this knowledge rather than attempting to rediscover it from source code — the same instinct behind [ADR-007](adr/ADR-007-cascade-rules-derived-from-topology.md)'s "derive from the graph that already exists, don't duplicate it by hand."

This is also a direct extension of the [Organisation Graph](org_graph_architecture.md)'s Engineering Topology Graph (§4). That graph's `topology_repositories`, `topology_services`, and `topology_edges` are populated by hand today (`POST /topology/repositories`, `POST /topology/services`, `POST /topology/edges`) — real, working, but manual. Monorepo Support is what makes that graph populate itself, at the scale and accuracy only the monorepo's own tooling can provide. The `topology_edges.basis` field already distinguishes `"inferred"` from `"manual"` for exactly this reason: it was designed anticipating this milestone, not built for it yet.

## 3. Design principles

- **Native integration** — consume the workspace graph from supported tools rather than rebuilding it. Nx has a project graph API; Bazel has `bazel query`; Turborepo and the various JS workspace managers expose their own dependency graphs. Read those, don't re-derive them from import statements.
- **Zero configuration** — detect supported monorepo tools automatically where possible (presence of `nx.json`, `turbo.json`, `WORKSPACE`/`MODULE.bazel`, `rush.json`, or a `workspaces` field in `package.json`).
- **Workspace-aware** — understand applications, libraries, packages, generated code, and ownership boundaries, not just "files in a directory."
- **Dependency-aware** — Captains, recommendations, and impact analysis should follow real dependency relationships, not just file imports. "If I change this shared library, which services are affected?" should be a graph traversal, not a grep.
- **Incremental by default** — re-index only the packages affected by a change, using the workspace tool's own affected-package detection where available (`nx affected`, `turbo run --filter`, Bazel's query language).
- **Tool-agnostic** — the runtime exposes one internal topology model regardless of whether the repository uses Nx, Turborepo, Bazel, or something else. Mission Control, Captains, and the Organisation Graph never care which adapter produced the data.

## 4. Architecture: the Workspace Adapter abstraction

Rather than writing "Nx support" as a first-class concept threaded through the codebase, monorepo tools are adapters that all produce the same canonical model. This is the same shape as the Enterprise Auth discussion earlier in this project's life (protocol adapters — SAML, OIDC, SCIM — rather than vendor classes): the *tool* is a config detail, not an architectural fork.

```
WorkspaceAdapter (interface)
├── NxAdapter
├── TurborepoAdapter
├── BazelAdapter
├── RushAdapter
├── PnpmWorkspacesAdapter
├── YarnWorkspacesAdapter
├── LernaAdapter
└── GenericGitRepositoryAdapter   -- the fallback: one project, the whole repo
```

Every adapter implements the same contract and produces the same canonical graph:

```ts
interface WorkspaceAdapter {
  /** Cheap, synchronous-ish check: does this repo use this tool? (config file presence) */
  detect(repoRoot: string): Promise<boolean>;

  /** Build the canonical Workspace Graph by reading the tool's own graph/config. */
  buildGraph(repoRoot: string): Promise<WorkspaceGraph>;

  /** Given a set of changed file paths, return the affected project names — used for
   *  incremental re-indexing. Falls back to "everything" if the tool has no native support. */
  affectedProjects(repoRoot: string, changedPaths: string[]): Promise<string[]>;
}
```

### Canonical Workspace Graph

```ts
interface WorkspaceGraph {
  tool: 'nx' | 'turborepo' | 'bazel' | 'rush' | 'pnpm' | 'yarn' | 'lerna' | 'generic';
  projects: WorkspaceProject[];
  edges: WorkspaceEdge[];       // dependency relationships between projects
}

interface WorkspaceProject {
  name: string;
  kind: 'application' | 'library' | 'package' | 'service' | 'generated';
  path: string;                 // relative to repo root
  owners?: string[];            // from CODEOWNERS or tool-native ownership metadata
  tags?: string[];               // tool-native tags, e.g. Nx's `tags` array
  buildTargets?: string[];       // e.g. ['build', 'test', 'lint'] — informational, not executed by ctxhub
}

interface WorkspaceEdge {
  from: string;                  // project name
  to: string;                    // project name
  kind: 'depends_on' | 'implicit_depends_on';  // implicit = tool-inferred, not declared
}
```

This maps directly onto the Org Graph's Topology Graph (§4 of `org_graph_architecture.md`): each `WorkspaceProject` becomes a `topology_repositories` or `topology_services` row (depending on `kind`), each `WorkspaceEdge` becomes a `topology_edges` row with `basis: "inferred"` and `edge_type: "depends_on"`. Cascade rule auto-derivation (ADR-007) then applies unchanged — a monorepo-inferred `depends_on` edge derives a cascade rule exactly the same way a manually-created one does.

## 5. What this unlocks

Standing on the monorepo tool's own graph, rather than re-deriving it, makes a class of query cheap that would otherwise require building a whole static-analysis engine:

- *"If I change this shared authentication library, which services, deployment pipelines, and teams are affected?"* — for Nx, this is close to `nx affected` plus ownership metadata, not a bespoke ctxhub feature.
- *"Show me every package that violates our dependency rules."* — Nx module boundaries, Bazel visibility rules, and similar tool-native constraints become queryable rather than re-implemented.
- *"Which projects depend on deprecated package X?"* — a graph traversal from X against `WorkspaceEdge`, independent of which tool produced the graph.

These become powerful specifically because ctxhub is standing on the monorepo tooling's own curated graph rather than duplicating it.

## 6. Phasing

Following the same phase-gate discipline as the rest of this roadmap (ADR-009, ADR-013): no adapter gets built until a real trigger makes the current gap the actual blocker, and adapters are added one at a time, not as a batch.

| Phase | Trigger | Deliverable |
| --- | --- | --- |
| Phase 0 — Generic fallback | Always available | `GenericGitRepositoryAdapter`: the whole repo is one project. This is what every workspace gets today (implicitly) — formalising it as the default adapter costs nothing and gives every other adapter something to fall back to |
| Phase 1 — First real adapter | An org on the enterprise track (or a VF3-style trial) runs a monorepo managed by a specific tool, and manual topology registration (`POST /topology/*`) is a friction point they've actually hit | One adapter, chosen by whichever tool that org uses — not chosen speculatively in advance. pnpm/Yarn Workspaces are the cheapest to build (a `workspaces` field in `package.json`, no external graph tool required) if there's no specific pull yet |
| Phase 2 — Additional adapters | Repeated requests for a specific second tool | Add adapters one at a time, each validated against a real repository using that tool, not synthetic fixtures |
| Phase 3 — Affected-project incremental indexing | Re-indexing whole monorepos on every change becomes a measured performance problem | Wire `affectedProjects()` into the indexer's re-index trigger |
| Phase 4 — Cross-project impact queries | Teams are asking the "if I change X, what's affected" question manually and often enough that it's worth a dedicated Captain/query surface | Build the query surface described in §5 on top of the by-then-populated Topology Graph |

## 7. We expect to learn

- Which monorepo tool is actually the first blocker — Nx, Turborepo, Bazel, or one of the JS workspace managers? (Not guessable in advance; this is exactly why Phase 1 waits for a real trigger.)
- Does `affectedProjects()` incremental indexing meaningfully change re-index latency in practice, or is ctxhub's existing indexing fast enough that it doesn't matter?
- Do engineers actually use topology-derived impact queries, or is per-project search sufficient once the graph exists?
- Is ownership metadata (CODEOWNERS, tool-native owners) reliable enough in real repos to drive anything beyond display?

## 8. Exit condition

An engineer on a real Nx (or equivalent) monorepo runs a ctxhub Captain that correctly scopes itself to the affected projects for a change, without any manual topology configuration — the Topology Graph populated itself from the monorepo tool's own graph.

## 9. Explicitly not in scope here

- Executing builds, tests, or any monorepo tool's own commands — ctxhub reads the graph, it does not orchestrate the build system.
- A universal dependency-rule enforcer — surfacing violations the tool already knows about (§5) is in scope; building a new rules engine on top is not.
- Any specific adapter implementation. This document is the design; no adapter has been built. See ROADMAP.md for trigger status.

*ctxhub Monorepo Support · v1 · Draft · July 2026*
