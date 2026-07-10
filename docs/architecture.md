# Architecture

How the pieces actually fit together. See [philosophy.md](./philosophy.md) for *why* they're
shaped this way, and the main [README.md](../README.md) for the full command/flag reference.

## Config and workspace discovery

`src/config/config.ts` walks upward from the current directory looking for `ctxhub.yaml` first,
then `.ctxhub/config.yaml`. Whichever directory has one becomes the *workspace root* — the base
for repo paths, the index, the cache, memory, hooks, skills, and MCP agent config. This is why a
command run from inside any configured child repo still operates on the parent workspace: config
discovery, not the current directory, decides scope. `ctxhub init` is the one exception; it always
creates a new config exactly where it's run.

## Indexing

`src/indexing/` chunks and indexes each configured repo's docs/code/architecture content into
either LanceDB (`index.provider: lancedb`, the default) or a `local-json` fallback with no native
dependency. Indexing is incremental (`src/indexing/manifest.ts` tracks per-file hashes so unchanged
files are skipped), and privacy-aware: environment files are excluded by default and common
secret-like patterns are redacted before a chunk is stored (`config.privacy.redactPatterns`).

`src/context/freshness.ts` compares a search result's indexed commit against the repo's actual
current HEAD/dirty state, so a result can be flagged `stale` when the repo has moved on since it
was indexed — this is a signal about the *index*, not a judgment about the content's truth.

Each file's "prepare" step (read, hash, redact, chunk, optional LLM summary) runs concurrently
across files (`index.concurrency`, default 8, via `src/utils/concurrency.ts`'s dependency-free
`mapWithConcurrencyLimit()`) — this work is I/O/subprocess-bound, not CPU-bound, so real OS threads
wouldn't help here the way concurrent async I/O does. The actual write to the index provider stays
strictly sequential, one file at a time in original file order, since overlapping multi-step writes
(remove-then-add, conditional full-text-index creation) isn't safe for every `IndexProvider` —
`LocalJsonIndex`'s naive whole-file read-mutate-write in particular would silently lose writes under
real concurrency.

`ctxhub watch` reacts to real filesystem events (via [chokidar](https://github.com/paulmillr/chokidar))
rather than only polling on a timer, debouncing a burst of changes into one re-index pass; `--interval`
remains as a periodic fallback, not the primary trigger. `--detach` runs it as a real background
process (PID file + logs under `.ctxhub/cache/watch.{pid,log}`, `--status`/`--stop` to manage it) —
intentionally not an OS-level service (launchd/systemd), matching the project's bias toward not
adding new infrastructure. `src/utils/notify.ts` provides opt-in (`--notify`) desktop notifications
for commands that can take a while, by shelling out to the OS's own notifier — the same
"reuse platform tools, no new dependency" pattern `report.ts`'s browser launch already uses.

## Memory: two layers, one clear boundary

ctxhub does not reimplement a memory engine. `src/memory/mempalaceCli.ts` shells out to MemPalace's
real CLI/Python internals (`mempalace.searcher`, `mempalace.mcp_server`) for every durable-memory
read and write; `src/memory/LocalJsonMemory.ts` is the dependency-free fallback when
`memory.provider: local-json`. Team-shared notes are a separate, git-tracked path entirely
(`src/commands/note.ts`, `<repo>/agent-notes/*.md`) — see
[philosophy.md](./philosophy.md#the-index-is-a-read-only-mirror-memory-is-a-separate-writable-layer)
for why these stay separate, and `ctxhub note promote` for the one explicit bridge between them.

A real bug worth knowing about if you touch this code: `mempalace.mcp_server`'s internal functions
redirect stdout for MCP-protocol hygiene (since that module is designed to run as a stdio MCP
server itself), so a JSON result can land on stderr instead, mixed with log noise.
`extractJsonPayload()` in `mempalaceCli.ts` handles this by trying each stream wholesale first,
then falling back to scanning every line of both streams for the last one that parses as JSON.

## MCP server

`src/mcp/server.ts` exposes ctxhub's capabilities as MCP tools for agent clients: `search`,
`memory_search`/`memory_timeline`, `repo_list`, `context_pack`, architecture tools, exact-context
expansion (`open_chunk`, `get_file_context`), and opt-in mutating tools gated behind explicit flags
(`--allow-index` for `index_workspace`/`sync_workspace`; `--allow-memory-write` for
`memory_add`/`diary_write`, a separate gate). Every response is auto-compacted (redundant content
dropped, compact encoding picked per payload, `maxTokens` trimming) since MCP responses count
against an agent's context budget directly.

## LLM-backed features: one consistent pattern

Every LLM-backed feature (`explain`, `pr-context`, `review`, `handoff`, draft note/diagram
synthesis, and others) is built on the same primitive, `runAgentPrompt()` in `src/llm/runAgent.ts`:
it shells out to whichever agent CLI (claude/codex/copilot/cursor) is configured or detected on
`PATH`, with a bounded timeout, and returns a discriminated result
(`{ ok: true, text } | { ok: false, reason, detail? }`). Callers turn that into a
`{ data, llmNotice? }` shape: real output when it works, a clear notice plus a non-LLM fallback
when it doesn't. `config.llm.enabled` (default `false`) is the single opt-in gate, checked before
any of this runs.

`src/llm/harness.ts`'s `AGENT_CAPABILITIES` table is the single source of truth for what each agent
harness actually supports (MCP config writing, skill install, headless invocation) — three
previously-independent lists (`agent.ts`, `skills.ts`, `runAgent.ts`) now derive from it.

## Review mode

`src/commands/review.ts` (`ctxhub review <topic> --as <persona>`) dispatches to a reviewer profile
loaded from `.ctxhub/cache/review-profiles.json` (auto-seeded with 5 built-ins on first run).
A profile's `kind` decides how it's answered: `contract`/`docs` reuse `pr-context`'s
`reviewContractRisks` and `graph --drift`'s `analyzeArchitectureDrift`/`suggestDriftRepairs`
unmodified; `generic` is a freeform LLM persona defined entirely by its `focus` text, so a team
adds a new reviewer by editing the profiles file, not by changing ctxhub's code.

## Report, graph, and confidence scoring

`ctxhub report` (`src/commands/report.ts`) writes one self-contained HTML file: a filterable list
view, a knowledge-graph view (repo/file/component/MemPalace-wing/room/hit nodes, with focus/
neighborhood highlighting, node-class filters, and clickable edges), and a MemPalace timeline view.
No server, no CDN assets — see [philosophy.md](./philosophy.md#local-first-no-server-by-default)
for why.

`buildProvenanceBacklinks()` links a memory hit to the real source file it names, when one
resolves (exact `repo:path` match, falling back to a path-only match, since a MemPalace "wing" is a
free-text label that doesn't always coincide with a configured repo name). `src/context/
confidence.ts`'s `computeConfidence()` scores every provenance-bearing item from those same
signals — source-type weight, recency, doc/code agreement, corroborating-source count — never an
LLM call, never a model's own self-rating.

## Skills

`src/commands/skills.ts` installs static, per-agent skill files (one focused skill per action,
mirroring [spec-kit](https://github.com/github/spec-kit)'s pattern) so an agent's own judgment or
an explicit `/ctxhub-search` invocation can discover ctxhub's capabilities without an MCP
connection specifically — skills and MCP tools are complementary surfaces, not duplicates of each
other.

## Personas

`agents/personas/*.md` (git-tracked, workspace-root, deliberately not under the gitignored
`.ctxhub/`) generalizes `ctxhub review`'s `ReviewerProfile` pattern into a cross-command persona
system — see [docs/personas.md](./personas.md) for the full review/adoption plan against the
Portable Agent Persona Specification. `src/personas/persona.ts` loads personas and an optional,
additive policy layer (`agents/policies/*.md`) that always applies regardless of persona, wired
into `explain`/`ask`/`handoff`/`review`'s `--as <persona>` and into `note`/`eval`/`diagram`'s
existing draft/suggestion prompts — empty by default, so nothing changes until a team runs
`ctxhub personas init`. `ctxhub personas sync` compiles personas per harness using the same
`AGENT_CAPABILITIES` table `skills.ts` already derives from, extended with `nativeSubagents`/
`projectInstructions`: all four supported harnesses have confirmed native subagent support, each
with a genuinely different file/format — `.claude/agents/<persona>.md` (Claude Code, YAML
frontmatter, confirmed live against the actual `claude` CLI), `.codex/agents/<persona>.toml`
(Codex CLI, TOML), `.github/agents/<persona>.agent.md` (GitHub Copilot CLI, YAML frontmatter), and
`.cursor/agents/<persona>.md` (Cursor, YAML frontmatter) — see
[docs/personas.md](./personas.md)'s Phase 3 for sources and per-harness verification confidence
(Codex's live verification surfaced a real caveat: the documented file format sits behind an
under-development feature flag in the currently installed CLI build).

## Workspace registry

`src/workspaces/registry.ts` holds a user-level pointer list at `~/.ctxhub/registry.json`
(`getCtxhubHome()`/`getRegistryPath()`, overridable via `CTXHUB_HOME` for test isolation) — Phase 1
of the control-plane vision (see [docs/control-plane.md](./control-plane.md)). It's deliberately
thin: `{ name, path, addedAt }` entries only. Each workspace continues to own its own
config/index/memory/personas exactly as before; the registry never duplicates or reaches into any
of that. `ctxhub workspace register` resolves the workspace root the same way every other command
does (`loadWorkspaceConfig`'s existing upward config discovery), defaults the registered name to
that workspace's own `config.workspace.name`, and is idempotent for an already-registered path
(returns the existing entry rather than erroring). `ctxhub workspace list` reports, but never
silently prunes, a workspace whose path no longer exists — the same "report, don't silently fix"
bias `ctxhub doctor` already uses for anything destructive.

## Control-plane service

`src/commands/service.ts` (CLI lifecycle) and `src/service/server.ts` (the HTTP handler) implement
Phase 2 of [docs/control-plane.md](./control-plane.md). `ctxhub service start` reuses
`ctxhub watch --detach`'s exact detached-process pattern — PID file + log file, just at user scope
(`~/.ctxhub/service.{pid,log}` via `registry.ts`'s `getCtxhubHome()`) instead of per-workspace — and
detaches by default rather than requiring an explicit flag, since a persistent service is the whole
point; `--foreground` is the escape hatch for debugging. The HTTP server itself is plain Node
`http` (no new dependency): `GET /health`, `GET /workspaces` (from the Phase 1 registry), and
`GET /workspaces/:name/status`, which calls `doctorChecks.ts`'s exact `buildDoctorChecks`/
`runDoctorChecks` functions rather than inventing separate health logic, so a workspace's
control-plane health can never drift from its `ctxhub doctor` health. The WebSocket event stream
from the original plan is deliberately not built yet — nothing in the system produces an event
worth pushing until a later phase (Captains) exists, so polling the HTTP API above is enough for
now.

## Mission Control (Fleet view)

`src/service/fleetView.ts` renders Phase 3's Fleet view — a self-contained HTML page served at
`GET /` by the same service. It follows `ctxhub report`'s established visual conventions (system-
ui sans-serif, light/dark via `prefers-color-scheme`, inline `<style>`/`<script>`, no CDN) but
works differently under the hood: its inline JS calls the live service's own JSON endpoints
client-side (`fetch('/workspaces')`, then per-workspace `fetch('/workspaces/:name/status')`) on
every page load, rather than embedding a snapshot once at generation time the way `ctxhub report`
does. That's deliberate — the Fleet view is meant to reflect the control plane's current state,
not a point-in-time report.

## Execution Profiles

`CtxhubConfig.executionProfiles` (`src/config/types.ts`, defaults to `{}`) binds a persona to a
specific harness + model — `{ persona?, runtime, model?, tags? }` — extending the already-shipped
persona system (`src/personas/`) rather than adding a new engine.
`src/execution/executionProfile.ts`'s `resolveExecutionProfile(config, name)` is a deliberately
thin lookup; the real behavior is in how `runAgentPrompt` (`src/llm/runAgent.ts`) now accepts
per-call `agent`/`model` overrides, taking priority over `config.llm.agent`/auto-detection with the
same never-silently-swap discipline the existing configured-agent path already has. `model` is
passed through as `--model` for claude and `-m` for codex (both verified against real `--help`
output); copilot/cursor accept the override without acting on it yet, since their invocations are
already best-effort/unverified. `ctxhub explain --profile <name>` is the reference integration —
`--as` always wins for framing when both are given, the profile's own `persona` is the default
otherwise, and other persona-driven commands can adopt the identical pattern incrementally.

## Central MCP Gateway

`ctxhub mcp --central` (`src/mcp/centralServer.ts`) is a stdio MCP server distinct from the
per-workspace one `ctxhub mcp` normally starts (`src/mcp/server.ts`). It exposes two tools --
`list_workspaces` (reads the Phase 1 registry) and `call_workspace_tool` (`{ workspace, tool,
arguments }`) -- and routes the latter into the named workspace's own, already-existing
`createCtxhubMcpServer` instance, lazily created and cached per workspace name, connected
in-process via the MCP SDK's own `InMemoryTransport.createLinkedPair()` rather than re-declaring
every tool's schema on the gateway itself. This deliberately diverges from `docs/control-plane.md`'s
original sketch (which described the gateway as proxying through the Phase 2 HTTP service): both
the gateway and the service read the same `~/.ctxhub/registry.json` directly, and no concrete need
was found for the gateway to depend on the service process being alive at all. Workspaces are
never merged into one global search space — a caller always names exactly which one a tool call
targets.

## Fleet/Workspace Captains

`src/captains/` implements Phase 6. A Captain task (`src/captains/tasks.ts`, `~/.ctxhub/captains.json`
via `ctxhub captain add/list/remove`) is plain, editable config — `{ name, workspace, query,
persona?, profile? }` — deliberately not a bare free-floating prompt: `runCaptainTask`
(`src/captains/runner.ts`) runs a task by calling the exact same evidence-grounded
`createExplainResult` function every other persona-driven command already uses, headlessly,
against the named registered workspace. `persona`/`profile` reuse Phase 4's Execution Profile
resolution exactly as `explain --as`/`--profile` do.

`ctxhub captain run <name>` is the trigger for this phase — manual, on demand; a scheduled trigger
(the Phase 2 service polling task definitions on an interval) wasn't built yet, tracked as a real
follow-up. Approval gating is real: `runCaptainTask` never writes to a repo, only to a user-level,
non-git-tracked pending-runs queue (`~/.ctxhub/captains/<task>/<runId>.json`, listed via
`ctxhub captain approvals <task>`). The one human-invoked action that promotes a pending run into
a real, team-visible artifact is `ctxhub captain promote <task> <runId> <repo>`, which reuses
`note.ts`'s existing `draftedNoteTemplate` unmodified — the same "AI draft, review before merge"
shape `note add --draft` already produces, not a second promoted-content format.
