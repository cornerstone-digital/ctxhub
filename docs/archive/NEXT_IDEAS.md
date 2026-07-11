# Next Ideas

Speculative feature ideas, grounded in a read of the full codebase. None of these are scheduled
or committed — they're candidates for discussion. Anything promoted out of here should get a
proper entry in [NEXT_FEATURES.md](./NEXT_FEATURES.md) with acceptance criteria.

Each idea notes what it would build on top of (so you know what's already in place), a rough
impact and effort score, and what would be required to build it. Ideas that conflict with the
project's stated "Not planned" decisions (no embeddings, no reimplementing MemPalace) are excluded.

---

## Scoring legend

- **Impact:** Low / Medium / High — developer time saved, incidents avoided, or quality improved.
- **Effort:** Trivial / Low / Medium / High — build cost, independent of whether it's worth it.

---

## Idea index

| # | Idea | Impact | Effort |
|---|---|---|---|
| 1 | [Inferred dependency graph from code imports](#1-inferred-dependency-graph-from-code-imports) | High | Medium |
| 2 | [Code ownership from git history](#2-code-ownership-from-git-history) | High | Low |
| 3 | [Knowledge gap detector](#3-knowledge-gap-detector) | High | Low |
| 4 | [Workspace pulse — automatic change narratives](#4-workspace-pulse--automatic-change-narratives) | High | Medium |
| 5 | [Cross-workspace question routing](#5-cross-workspace-question-routing) | High | Medium |
| 6 | [Contradiction and inconsistency detector](#6-contradiction-and-inconsistency-detector) | High | Medium |
| 7 | [Onboarding path generator](#7-onboarding-path-generator) | High | Medium |
| 8 | [Budget and cost tracking for direct-api profiles](#8-budget-and-cost-tracking-for-direct-api-profiles) | Medium | Low |
| 9 | [Workspace time-travel — historical re-indexing](#9-workspace-time-travel--historical-re-indexing) | Medium | High |
| 10 | [Ownership-aware Captain routing](#10-ownership-aware-captain-routing) | Medium | Low |
| 11 | [Workspace health score over time](#11-workspace-health-score-over-time) | Medium | Medium |
| 12 | [Git author metadata in search results](#12-git-author-metadata-in-search-results) | Medium | Low |
| 13 | [Smart context eviction for long sessions](#13-smart-context-eviction-for-long-sessions) | Medium | Medium |
| 14 | [Workspace templates for `ctxhub init`](#14-workspace-templates-for-ctxhub-init) | Medium | Low |
| 15 | [PR comment integration for `ctxhub review`](#15-pr-comment-integration-for-ctxhub-review) | Medium | Medium |
| 16 | [Automatic changelog from agent-notes](#16-automatic-changelog-from-agent-notes) | Low–Medium | Low |
| 17 | [Multi-provider fallback chains in execution profiles](#17-multi-provider-fallback-chains-in-execution-profiles) | Medium | Medium |
| 18 | [Cursor MCP config support](#18-cursor-mcp-config-support) | Medium | Trivial |

---

## 1. Inferred dependency graph from code imports

**What it is**

The current `architecture_map` is built exclusively from hand-written Mermaid diagrams. Most
workspaces have incomplete or absent Mermaid coverage, which means the graph is only as good
as the team's documentation discipline. An inferred dependency graph would parse actual import
statements, `package.json` dependencies, Go `import` blocks, Python `import` lines, etc. and
build a real-time graph of what depends on what — without requiring anyone to write a diagram.

**What's already in place**

- `src/indexing/chunk.ts` already parses TypeScript/JS files symbol-by-symbol and extracts
  component/relationship metadata from Mermaid blocks.
- `ctxhub graph` already assembles a component list and serves it via `architecture_map`.
- The LanceDB index already stores `kind: architecture-diagram` chunks separately.

**What's new**

- At index time, alongside chunking, run a lightweight import extractor per language:
  - TS/JS: parse `import ... from '...'` and `require(...)` statements (regex — no full TS compiler needed for inter-repo deps)
  - Python: `import x`, `from x import y`
  - Go: `import "..."` blocks
- Store inferred edges as a new chunk kind: `kind: inferred-dependency` with `source` and `target` repo/module fields.
- Expose a new MCP tool `dependency_map(repo?)` that merges inferred edges with diagram-derived ones.
- In `ctxhub graph`, show both layers with a visual distinction ("documented" vs "inferred").

**Why it matters**

This makes architecture drift detection far more powerful. Today, drift means "your diagram
doesn't match your package.json." With inferred deps, drift means "your diagram says Service A
calls Service B, but the code says A also calls C and D, which aren't in any diagram." Every
workspace gets a dependency graph on day one, before anyone writes a Mermaid file.

**Impact: High | Effort: Medium**

---

## 2. Code ownership from git history

**What it is**

`ctxhub blame` — infer code ownership per file, directory, or repo from git commit history. "Who
should I ask about this?" is one of the most common questions in a multi-repo workspace, and the
answer is always in git, never in documentation.

**What's already in place**

- `src/indexing/indexer.ts` already calls `getCurrentCommit()` and stores commit SHA per chunk.
- Freshness detection already runs `git log` to compare HEAD against the indexed commit.
- The manifest tracks `commit`, `indexedAt`, and file hashes per file.

**What's new**

- At index or sync time, run `git log --follow --format="%ae" -- <file>` per repo file and count
  author commit frequency over a rolling 90-day window.
- Store ownership as file-level metadata alongside the manifest: `{ file, topAuthors: [{ email, commitCount }] }`.
- Expose ownership via:
  - `ctxhub blame <path>` — who owns this file/directory?
  - A new MCP tool `file_owners(repo, path)` for agents doing cross-repo impact analysis.
  - In `ctxhub report`, show top contributor badges on the graph node for each repo/file.
- Wire it into `pr-context`: "Files changed on this branch are primarily owned by alice@corp.com."
- Wire it into Captain routing (see idea #10).

**Why it matters**

Agents currently have no way to answer "who should review this?" or "who should I escalate to?"
This is a zero-LLM, deterministic signal that dramatically improves the quality of handoff
documents and review routing.

**Impact: High | Effort: Low**

---

## 3. Knowledge gap detector

**What it is**

`ctxhub gaps` — find code that exists in the repos but has no corresponding documentation,
architecture diagrams, agent notes, or test files. Surface these as actionable findings rather
than waiting for a developer to notice them.

**What's already in place**

- The index already knows the `kind` of every chunk: `code`, `docs`, `architecture`, `notes`.
- `ctxhub graph --drift` already compares diagram components to package.json.
- `ctxhub validate docs` already checks for broken links in Markdown.
- The manifest tracks which files are indexed and when.

**What's new**

- For each repo, cross-reference:
  - Code files that have no sibling documentation (no `.md` in the same directory, no `agent-notes/` entry citing the file, no chunk in the same repo with `kind: docs` citing the file path)
  - Exported symbols (from the existing symbol extractor) that appear in no docs or architecture diagrams
  - Directories with high churn (many recent commits) but no ADRs or notes
- Output as `ctxhub gaps [--repo <name>] [--type docs|tests|diagrams|notes]`
- `--fail-on-gaps` flag for CI (parallel to `--fail-on-drift`)
- MCP tool `knowledge_gaps(repo?, type?)` so agents can proactively notice what's undocumented

**Why it matters**

ctxhub's whole value is making the workspace legible. Right now it can only surface what's there —
it can't tell you what's missing. The gap detector inverts this. It's also a forcing function for
docs discipline without requiring a separate linter.

**Impact: High | Effort: Low**

---

## 4. Workspace pulse — automatic change narratives

**What it is**

The running `ctxhub service` already polls Captain tasks on a 60-second tick. It could also poll
for workspace changes and, when it detects a significant burst of commits, generate a short
natural-language narrative: "Between 2pm and 6pm, 14 commits landed across 3 repos. The main
change was the migration from JWT to session tokens in `auth-service`, with supporting changes
in `api-gateway`'s middleware." These "pulse entries" are a form of ambient changelog.

**What's already in place**

- `ctxhub watch` already detects file changes and re-indexes.
- `ctxhub handoff` already generates structured narratives from a context pack.
- `createExplainResult()` is already callable headlessly (Captains use it).
- The service's 60s poll loop is already in `src/commands/service.ts`.

**What's new**

- Extend the service poll to compare the manifest's `commit` fields against current repo HEADs.
- When N or more files change across repos within a time window (configurable threshold), trigger
  a headless `createExplainResult()` with a fixed "summarise recent changes" prompt over the diff.
- Write the result as a pulse entry: `~/.ctxhub/pulse/<date>-<id>.json`.
- Surface pulse entries in the Fleet view (a "Recent activity" section below the workspace list).
- `ctxhub pulse [--since <duration>]` CLI command to read recent pulse entries.
- MCP tool `recent_changes(since?)` for agents that want to orient themselves at the start of a session.

**Why it matters**

The biggest usability gap today is that an agent starting a new session has no way to know "what
happened while I was away." The only mechanism is manual `ctxhub handoff`, which requires a
human to think to run it. A pulse that runs itself transforms ctxhub from a pull-based context
server into something that proactively narrates the workspace.

**Impact: High | Effort: Medium**

---

## 5. Cross-workspace question routing

**What it is**

The central MCP gateway (`ctxhub mcp --central`) currently routes `call_workspace_tool` to a
named workspace — you must know which workspace to ask. This idea adds a `cross_workspace_search`
MCP tool that fans the query out to all registered workspaces and merges results.

**What's already in place**

- `src/mcp/centralServer.ts` already lazily instantiates and caches one MCP client per registered
  workspace via `InMemoryTransport`.
- The `search` tool already returns a scored result list with repo/path metadata.
- `list_workspaces` already surfaces workspace names and health.

**What's new**

- New MCP tool: `cross_workspace_search(query, limit?, type?)` — fans the query to all healthy
  registered workspaces in parallel, collects results, merges and re-ranks by score, returns a
  combined list with a `workspace` field on each result.
- New MCP tool: `cross_workspace_pack(query)` — same idea for `context_pack`, useful when an
  agent spans a "shared libraries" workspace and a "main app" workspace.
- New CLI: `ctxhub search --all-workspaces <query>` (requires the service to be running).

**Why it matters**

Many real setups have more than one workspace — a monorepo plus a libraries workspace, or a
frontend plus a backend. Today, an agent must know to route to the right one, or the human must
configure a single mega-workspace. Cross-workspace search lets each workspace stay isolated (no
merged indexes) while still supporting questions that span them.

**Impact: High | Effort: Medium**

---

## 6. Contradiction and inconsistency detector

**What it is**

`ctxhub contradictions` — find documentation that contradicts itself across the workspace.
"The auth-service README says we use JWT. The ADR from March says we migrated to OAuth2. The
API docs still show JWT examples." This is distinct from drift (diagram vs. code reality) —
it's inconsistency within the documentation layer itself.

**What's already in place**

- The index stores all docs and notes as searchable chunks with source metadata.
- `ctxhub explain` already grounds answers in indexed evidence.
- `computeConfidence()` already scores items by whether doc/code agreement holds.
- The LLM layer can already reason over a context pack.

**What's new**

- For each "key claim" topic — gathered via configurable topic seeds or extracted via LLM from the
  architecture room — run a context pack query and then ask the LLM: "do any of these sources
  contradict each other?"
- Output as a structured finding list: contradicting source A (repo:path) vs. source B (repo:path),
  with the specific conflicting claims quoted.
- `ctxhub contradictions [--topic <seed>]` — manual, interactive mode.
- As a Captain task: run contradiction checks on a schedule, produce a weekly report.
- MCP tool `check_consistency(query)` so agents can verify a claim before making it.

**Why it matters**

In a long-lived multi-repo workspace, documentation diverges silently. No tool today catches the
case where two documents both accurately described the world when they were written, but the world
has since changed under one of them. This is the hardest kind of stale doc to find because it
doesn't show up in any lint check.

**Impact: High | Effort: Medium**

---

## 7. Onboarding path generator

**What it is**

`ctxhub onboarding-path` — given a new developer joining the workspace, generate a suggested
reading order for the codebase. Not "here's everything indexed," but a sequenced path: "Start with
these two architecture docs that explain the overall shape. Then read these three ADRs. Then look at
the auth-service README, then the API gateway, then these five agent-notes about known gotchas."

**What's already in place**

- The index already tracks `kind` (docs, code, architecture, notes) for every chunk.
- `architecture_map` already extracts component relationships — a natural dependency graph for
  reading order.
- Confidence scoring already prioritizes corroborated, recent sources.
- `ctxhub explain` already synthesizes answers grounded in evidence.

**What's new**

- A `buildOnboardingPath()` function that:
  1. Gathers all architecture chunks (high-level first)
  2. Gathers ADRs (detectable by path pattern `adr/`, `decisions/`)
  3. Gathers repo READMEs
  4. Gathers agent-notes sorted by recency
  5. Scores each by: centrality in the dependency graph, recency, and confidence
  6. Builds a sequenced reading list with section headers and one-line summaries
- `ctxhub onboarding-path [--role architect|developer|reviewer] [--out <file>]` — writes a
  Markdown document that can be committed or sent to a new joiner.
- With `llm.enabled`: LLM-authored one-line descriptions; without: heading/symbol summary.
- MCP tool `onboarding_path(role?)` so an agent can orient a new team member on demand.

**Why it matters**

"Orient me" is the most common first question from a new developer or a fresh agent session.
Today this requires someone to write a document by hand. An onboarding path gives structure that
a flat `ctxhub explain` answer can't — you know what to read before what, and why.

**Impact: High | Effort: Medium**

---

## 8. Budget and cost tracking for direct-api profiles

**What it is**

When using `direct-api` execution profiles (OpenRouter, Ollama, etc.), track token usage and
estimated cost per Captain task, per profile, and per time period. Support configurable budget
limits that pause a Captain task when exceeded.

**What's already in place**

- `src/mcp/compact.ts` and `textResult()` already estimate tokens and track savings in
  `.ctxhub/cache/stats.json` via `usage_stats`.
- `src/gateway/openaiCompatible.ts` receives the full API response including `usage` fields
  (prompt_tokens, completion_tokens, total_tokens) from OpenAI-compatible providers.
- Execution profiles already have `tags` which can include cost-tier markers.
- The service fleet view already shows per-workspace health.

**What's new**

- Parse `usage` from the OpenAI-compatible response and record it alongside the Captain run
  result in `~/.ctxhub/captains/<task>/<runId>.json`.
- Accumulate totals per profile per day/week in `.ctxhub/cache/spend.json`.
- `ctxhub budget [--profile <name>] [--since <duration>]` — show spend summary.
- Add `budget: { dailyUsdLimit: 5.00 }` to execution profile config; pause Captain tasks that
  would exceed the limit and surface the pause reason in the approvals queue.
- Expose spend in the Fleet view alongside workspace health.

**Why it matters**

Once Captain tasks run on a schedule, cost is no longer theoretical. An unintentionally verbose
profile or a runaway Captain task can generate real charges. This is the difference between
ctxhub being safe to leave running versus something that requires active monitoring.

**Impact: Medium | Effort: Low**

---

## 9. Workspace time-travel — historical re-indexing

**What it is**

`ctxhub time-travel --at <commit|date>` — re-index the workspace as of a specific git commit or
date, then run a search, explain, or pack against it. "What did the auth system look like before
the OAuth migration? What was the API contract when v2.0 shipped?"

**What's already in place**

- `src/indexing/indexer.ts` already calls `git log` for commit SHA and uses it for freshness.
- The manifest already records commit SHAs per file.
- `ctxhub replay` already re-reads a saved context-pack artifact from disk.

**What's new**

- `ctxhub time-travel --at <ref> [--workspace <name>]` — check out the workspace repos to the
  given ref (or the closest commit before the given date), index into a temporary named snapshot
  index, run a given query against it, then restore.
- Snapshot indexes stored in `.ctxhub/snapshots/<ref>/` — reusable without re-indexing if you
  query the same ref twice.
- `ctxhub search --snapshot <ref> <query>` — search against a snapshot without touching the
  working tree (requires the snapshot to already exist).
- The central MCP gateway could expose this via `call_workspace_tool` with a `snapshot` parameter.

**Why it matters**

Post-incident analysis, regression hunting, and "what changed between releases" are common
engineering workflows that today require leaving ctxhub entirely and going back to plain git
blame. Time-travel would make ctxhub the single tool for both current-state and historical
questions.

**Impact: Medium | Effort: High**

---

## 10. Ownership-aware Captain routing

**What it is**

When a Captain task produces a pending run, route it to the right human reviewer based on who
owns the relevant code (from idea #2). Instead of all Captain runs landing in a single undirected
approval queue, each run is tagged with its likely reviewers.

**What's already in place**

- Captain runs already write to `~/.ctxhub/captains/<task>/<runId>.json` with full metadata.
- `ctxhub captain approvals` already lists pending runs.
- `ctxhub captain promote` already turns a run into a note.
- Idea #2 (ownership from git) would provide `topAuthors` per file.

**What's new**

- When a Captain task completes, resolve the top owners of the files mentioned in the run's
  context pack and store them as `suggestedReviewers` in the run JSON.
- `ctxhub captain approvals` shows `suggestedReviewers` alongside the pending run summary.
- `ctxhub captain approvals --reviewer alice@corp.com` filters the queue to runs relevant to Alice.
- Fleet view: "You have 3 pending runs that mention files you own."
- A `captain.notify` config option that sends a desktop notification (via the existing
  `src/utils/notify.ts` shell-out) when a run lands for your files.

**Why it matters**

The approval queue becomes useful at scale only if it's routed. A single undifferentiated queue
that everyone has to read is a queue nobody reads.

**Impact: Medium | Effort: Low** *(requires idea #2 first)*

---

## 11. Workspace health score over time

**What it is**

A time-series health dashboard that tracks workspace quality metrics across multiple dimensions
and shows whether things are getting better or worse — not just a point-in-time snapshot.

**What's already in place**

- `ctxhub doctor` already computes a point-in-time health check across many dimensions.
- `ctxhub eval` already tracks search-quality scores in `.ctxhub/cache/evals/` with run history.
- `computeConfidence()` already provides a quality signal per indexed item.
- The service already has a `/workspaces/:name/status` endpoint that calls doctor's own functions.

**What's new**

- After each `ctxhub index`, `ctxhub sync`, and `ctxhub eval` run, append a health snapshot to
  `.ctxhub/cache/health-history.jsonl`: timestamp, index file count, freshness ratio, eval pass
  rate, docs-to-code ratio, architecture-diagram count, drift-finding count.
- `ctxhub health [--since <duration>] [--json]` — show trends over time.
- In `ctxhub report`, add a "Health trends" section: sparklines for each dimension over the last
  30 days (all inline SVG, no CDN).
- Fleet view: show a trend arrow (improving / stable / declining) next to each workspace.

**Why it matters**

A single-point health check tells you where you are. A trend tells you where you're going. Most
workspace quality problems (growing doc debt, declining eval scores) are slow-moving — visible
only as trends, not snapshots.

**Impact: Medium | Effort: Medium**

---

## 12. Git author metadata in search results

**What it is**

Include the author and date of the last commit that changed each file in search results and
context packs. "This auth code was last changed by alice@corp.com, 3 days ago" gives context
that the current freshness flag (stale/fresh) alone doesn't.

**What's already in place**

- `src/indexing/indexer.ts` already calls `git log` for commit SHA.
- The manifest already stores the commit SHA per file.
- `IndexedChunk` already has `commit`, `indexedAt`, and `lastModified` fields.
- The `search` tool already returns `commit` and freshness metadata.

**What's new**

- At index time, additionally run `git log -1 --format="%ae|%an|%ai" -- <file>` to get author
  email, author name, and commit date. Store in the manifest and in the chunk metadata.
- Expose `authorEmail`, `authorName`, `commitDate` on `IndexedChunk` and in MCP search results.
- Add to the search TUI: show "Last: alice, 3d" alongside the freshness indicator.
- In `ctxhub pr-context`: "Most changed files on this branch were last touched by…"

**Why it matters**

Small change, outsized value for cross-repo work. Knowing who last changed something is the
fastest path to knowing who to ask, and the data is already in the repo.

**Impact: Medium | Effort: Low**

---

## 13. Smart context eviction for long sessions

**What it is**

`excludeSeen` (already shipped) prevents re-sending chunks an agent has already seen. This extends
that to explicit session topics — an agent can declare "I'm done with authentication, evict those
results so I have budget for billing," and ctxhub will stop including seen auth chunks in future
responses.

**What's already in place**

- The `search` tool already supports `excludeSeen: true`, tracking seen chunk IDs in a
  per-session in-memory set.
- `textResult()` already applies `maxTokens` budget trimming.
- `context_pack` already de-dupes across its own search and architecture sub-queries.

**What's new**

- New MCP tool: `evict_topic(query)` — marks all chunks matching the query as evicted for this
  session. They won't appear in future results even if `excludeSeen` would normally include them.
  Returns the count of chunks evicted.
- `clear_evictions()` — resets the eviction list (useful when switching to a new task).
- `forget_chunk(id)` — evict a specific chunk the agent received in a previous result.
- No persistence needed — these live in the same in-memory session set as `excludeSeen`.

**Why it matters**

Context budget management is currently all-or-nothing. Real agent sessions often have multiple
sequential topics where previous context actively hurts by consuming budget. Topic-scoped eviction
lets an agent manage its own working memory without ctxhub needing to understand session semantics.

**Impact: Medium | Effort: Medium**

---

## 14. Workspace templates for `ctxhub init`

**What it is**

`ctxhub init --template <name>` — pre-configure a new workspace with sensible defaults for common
project shapes: TypeScript monorepo, Python microservices, Go multi-module, docs-only, etc.

**What's already in place**

- `ctxhub init` already creates `ctxhub.yaml` with a minimal scaffold.
- `ctxhub onboard` already runs a wizard to set up repos.
- `ctxhub personas init` already scaffolds `agents/` from a template.
- `examples/reference-workspace/` is already a working example for demo purposes.

**What's new**

- A `templates/` directory with named templates as YAML fragments:
  ```
  templates/
    typescript-monorepo.yaml
    python-services.yaml
    go-modules.yaml
    docs-workspace.yaml
  ```
- Each template includes suggested include/exclude globs per language, architecture room seeds,
  privacy redaction patterns for that ecosystem, and starter eval golden queries.
- `ctxhub init --template typescript-monorepo` merges the template into the generated config.
- `ctxhub template list` shows available templates.
- With `llm.enabled`: after init, offer to detect the project shape and suggest a template
  automatically (same pattern as `--suggest-globs`).

**Why it matters**

The first ctxhub experience requires reading the docs to know what include/exclude globs make
sense for your repo type. The right defaults for a TypeScript monorepo (skip `dist/`,
`node_modules/`, `.turbo/`; include `packages/*/src/**`) are obvious in hindsight but invisible
to a new user.

**Impact: Medium | Effort: Low**

---

## 15. PR comment integration for `ctxhub review`

**What it is**

`ctxhub review --as <persona> --post-pr-comment` — after generating review findings, post them
as PR comments on GitHub/GitLab rather than only writing to a local handoff file.

**What's already in place**

- `ctxhub review` already generates structured findings with severity and citations.
- `ctxhub pr-context` already knows the current branch and diff.
- `ctxhub handoff` already assembles a Markdown document from findings.

**What's new**

- Detect the git remote URL and infer the PR API endpoint (GitHub REST API or GitLab equivalent).
- `--post-pr-comment [--pr <number>]` flag: if `--pr` is omitted, detect the open PR for the
  current branch via the API.
- Post each finding as an inline review comment on the relevant file+line, or as a summary
  PR comment if findings aren't line-specific.
- Credential source: `GITHUB_TOKEN` / `GITLAB_TOKEN` env vars (never stored in config).
- Dry-run by default: always show what would be posted and ask for confirmation.
- A `ci` mode (no confirmation) for use in GitHub Actions.

**Why it matters**

Today, ctxhub review lives in a terminal or local file. The people who need to see it are reading
GitHub PR reviews. Bridging these two means ctxhub's analysis enters the team's actual review
workflow instead of being a parallel, disconnected process.

**Impact: Medium | Effort: Medium**

---

## 16. Automatic changelog from agent-notes

**What it is**

`ctxhub changelog [--since <date|tag>] [--out <file>]` — synthesize the accumulated
`agent-notes/` entries from the workspace into a human-readable changelog or project narrative.

**What's already in place**

- `ctxhub note add` creates dated, consistently-formatted notes in `<repo>/agent-notes/`.
- The index already tracks `kind: notes` for every agent note, with `indexedAt` and file path.
- `ctxhub handoff` already generates a structured narrative from a context pack.
- `createExplainResult()` is already callable headlessly.

**What's new**

- `ctxhub changelog --since 2025-06-01 [--out CHANGELOG_DRAFT.md]`:
  1. Search the index for `kind: notes` chunks with `indexedAt` after the given date.
  2. Sort by date, group by repo.
  3. With `llm.enabled`: synthesize into a structured narrative (sections per theme, not per repo).
  4. Without: format the raw notes into a structured Markdown table.
- Always output a draft, marked as pending human review.
- As a Captain task: generate a weekly changelog draft on a schedule, put it in the approvals
  queue for a human to promote into the main `CHANGELOG.md`.

**Why it matters**

Agent notes are a growing body of team knowledge that accumulates silently in a directory most
developers don't read. A synthesized changelog makes the notes visible and gives them a lifecycle:
from raw observation to reviewed artifact to changelog entry.

**Impact: Low–Medium | Effort: Low**

---

## 17. Multi-provider fallback chains in execution profiles

**What it is**

Execution profiles today bind one harness/provider/model. This idea adds fallback chains: "try
`claude-code` with `claude-opus-4` first; if it fails or is unavailable, fall back to
`openrouter-economy`."

**What's already in place**

- `src/execution/executionProfile.ts` already selects a single profile and calls the appropriate
  adapter.
- `RunAgentResult` already has a discriminated `{ ok: false, reason }` shape that all callers
  handle gracefully.
- The gateway adapter returns the same result shape as `runAgentPrompt()`.

**What's new**

- Extend execution profile config with `fallbacks: [profileName, ...]`:
  ```yaml
  executionProfiles:
    primary:
      runtime: claude-code
      model: claude-opus-4
      fallbacks: [openrouter-economy, local-ollama]
  ```
- `runAgentPromptFnForProfile()` tries each profile in order, returns the first success.
  Records which profile was actually used in the result metadata.
- `ctxhub explain --profile primary` shows which fallback was used if the primary failed.
- Budget tracking (idea #8) accumulates cost across all attempts, not just the successful one.

**Why it matters**

Enterprise environments often have primary gateways that are rate-limited or periodically
unavailable. A fallback chain makes ctxhub self-healing rather than requiring a human to
reconfigure and retry.

**Impact: Medium | Effort: Medium**

---

## 18. Cursor MCP config support

**What it is**

`ctxhub agent cursor` — `cursor` is the only harness in `AGENT_CAPABILITIES` with `mcpConfig:
false`. This means Cursor users must wire ctxhub's MCP server manually. The fix is mechanical:
verify Cursor's config file path/format, add `writeCursorMcpConfig()`, set `mcpConfig: true`.

**What's already in place**

- `src/llm/harness.ts`'s `AGENT_CAPABILITIES` table has `mcpConfig: false` for cursor with a
  comment explaining the gap.
- All the merge/write logic in `src/commands/agent.ts` is already parameterized by the
  capabilities table — adding cursor support changes two things: one flag in `harness.ts` and one
  new `writeCursorMcpConfig()` function.

**What's new**

- Verify Cursor's actual MCP config file path and format (`.cursor/mcp.json`, similar to
  Claude's `.mcp.json`).
- Add `writeCursorMcpConfig()` in `src/commands/agent.ts` mirroring `writeClaudeMcpConfig()`.
- Set `mcpConfig: true` in harness.ts and add `cursor` to the `ctxhub agent` command's options.
- Verify live against the actual Cursor binary (same standard as claude's verification note in ROADMAP).

**Why it matters**

Cursor is one of the most widely used AI-native editors. The gap is small and the fix is
mechanical — the only blocker is live verification.

**Impact: Medium | Effort: Trivial**

---

## Implementation priority suggestion

Easiest wins with no external dependencies, roughly in order:

1. **#18 Cursor MCP config** — trivial, closes a visible gap for Cursor users.
2. **#12 Git author metadata** — two lines of `git log` in the indexer; immediate value in all search results.
3. **#3 Knowledge gap detector** — pure index query, no new data collection needed.
4. **#8 Budget tracking** — the OpenAI-compatible gateway already receives usage data; storing and surfacing it is straightforward.
5. **#14 Workspace templates** — YAML files and a `--template` flag on `init`.
6. **#16 Automatic changelog** — thin wrapper over existing note indexing and `createExplainResult()`.

Ideas that depend on other ideas landing first:

- **#10 Ownership routing** needs **#2** (git blame data) to exist.
- **#4 Workspace pulse** builds on the Captain run infrastructure and is more valuable once **#12** (author data) is in place.
- **#5 Cross-workspace search** builds on the central MCP gateway (already shipped) and is more useful once **#11** (health trends) makes the multi-workspace fleet view richer.
