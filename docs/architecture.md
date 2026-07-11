# Architecture

How the pieces actually fit together. See [philosophy.md](./philosophy.md) for *why* they're
shaped this way, and the main [README.md](../README.md) for the full command/flag reference.

## System overview

```
┌─────────────────────────────────────────────────────────┐
│                     User / Agent                        │
└──────────────┬──────────────────────────┬──────────────┘
               │ CLI commands              │ MCP tools
               ▼                           ▼
┌──────────────────────────────────────────────────────────┐
│                   Commands layer                          │
│  explain · review · handoff · pr-context · captain …     │
└──────┬───────────────────┬──────────────────────┬────────┘
       │                   │                       │
       ▼                   ▼                       ▼
┌─────────────┐   ┌─────────────────┐   ┌──────────────────┐
│  Indexing   │   │   LLM layer     │   │   MCP server     │
│  pipeline   │   │  runAgent.ts /  │   │  server.ts +     │
│  LanceDB /  │   │  gateway        │   │  centralServer   │
│  local-json │   │  adapters       │   │                  │
└──────┬──────┘   └────────┬────────┘   └──────────────────┘
       │                   │
       ▼                   ▼
┌──────────────────────────────────────────────────────────┐
│                     Storage layer                         │
│   LanceDB index · manifest · MemPalace · agent-notes/    │
└──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│               Control plane (optional)                    │
│   Workspace Registry · Service · Fleet View               │
│   Captains · Execution Profiles · Central MCP Gateway    │
└──────────────────────────────────────────────────────────┘
```

## Key source files

| Area | Key files | What they own |
|---|---|---|
| Config | `src/config/config.ts`, `types.ts` | Upward discovery, schema, execution profile types |
| Indexing | `src/indexing/indexer.ts`, `chunk.ts`, `manifest.ts`, `redact.ts` | Pipeline, chunking, dedup, privacy |
| Index providers | `LanceDbIndex.ts`, `LocalJsonIndex.ts` | Storage backends |
| Freshness | `src/context/freshness.ts` | Stale/fresh flag per chunk |
| Confidence | `src/context/confidence.ts` | Score computation (no LLM) |
| LLM | `src/llm/runAgent.ts`, `harness.ts` | Headless agent invocation, capabilities table |
| Gateway | `src/gateway/openaiCompatible.ts` | direct-api path (OpenRouter, Ollama, etc.) |
| Memory | `src/memory/mempalaceCli.ts`, `LocalJsonMemory.ts` | MemPalace passthrough + fallback |
| MCP | `src/mcp/server.ts`, `centralServer.ts`, `compact.ts` | Tool surface, central gateway, compaction |
| Personas | `src/personas/persona.ts`, `src/commands/personas.ts` | Load, policy layer, compile to harnesses |
| Review | `src/commands/review.ts` | Reviewer profile dispatch |
| Report | `src/commands/report.ts` | Self-contained HTML report |
| Control plane | `src/workspaces/registry.ts`, `src/service/server.ts`, `src/captains/` | Registry, HTTP service, Captains |
| Execution profiles | `src/execution/executionProfile.ts` | Profile resolution, routing |

---

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

**Chunk types by file kind:**

| File type | Chunking strategy |
|---|---|
| `.mmd` / `.mermaid` | Single architecture chunk; components and relationships extracted |
| `.ts` / `.js` / `.tsx` / `.jsx` | Symbol-aware: whole top-level functions/classes via brace-matching heuristic |
| Markdown | Split on headings |
| Plain text / other | Paragraph-split |
| Large files (> 2000 chars) | Optional LLM-generated summary chunk prepended (requires `llm.enabled`) |

**Prepare phase runs concurrently; write phase is strictly sequential:**

```
File list
   │
   ├─ [concurrent, up to index.concurrency=8]
   │     read → hash → redact → chunk → (optional LLM summary)
   │
   └─ [sequential, one file at a time]
         remove old chunks → write new chunks → update manifest
```

This split matters: the prepare work is I/O/subprocess-bound so parallelism helps (~2.4× measured
on 300 files); the write phase must stay sequential because `LocalJsonIndex` does a whole-file
read-mutate-write that would silently corrupt under concurrent writes.

`src/context/freshness.ts` compares a search result's indexed commit against the repo's actual
current HEAD/dirty state, so a result can be flagged `stale` when the repo has moved on — this is
a signal about the *index*, not a judgment about the content's truth.

`ctxhub watch` reacts to real filesystem events (via [chokidar](https://github.com/paulmillr/chokidar))
rather than only polling on a timer, debouncing a burst of changes into one re-index pass; `--interval`
remains as a periodic fallback, not the primary trigger. `--detach` runs as a real background
process (PID file + logs under `.ctxhub/cache/watch.{pid,log}`) — intentionally not an OS-level
service (launchd/systemd), matching the project's bias toward not adding new infrastructure.
`src/utils/notify.ts` provides opt-in (`--notify`) desktop notifications by shelling out to the
OS's own notifier — the same "reuse platform tools, no new dependency" pattern `report.ts`'s
browser launch already uses.

## Memory: two layers, one clear boundary

ctxhub does not reimplement a memory engine. Three distinct storage paths exist:

| Path | Implementation | For |
|---|---|---|
| Durable memory (production) | `src/memory/mempalaceCli.ts` shells out to MemPalace's real Python internals | Personal/session notes, recalled across sessions |
| Durable memory (fallback) | `src/memory/LocalJsonMemory.ts` — keyword search over a JSON store | Testing and offline use when MemPalace is unavailable |
| Team-shared notes | `<repo>/agent-notes/*.md` — git-tracked Markdown files | Notes that should appear in a PR diff and be indexed alongside source |

The index itself is read-only and never receives agent scratch notes. See
[philosophy.md](./philosophy.md#the-index-is-a-read-only-mirror-memory-is-a-separate-writable-layer)
for why. `ctxhub note promote` is the one explicit bridge from private memory to team notes.

**Known gotcha if you touch `mempalaceCli.ts`:** `mempalace.mcp_server`'s internal functions
redirect stdout for MCP-protocol hygiene, so a JSON result can land on stderr instead, mixed with
log noise. `extractJsonPayload()` handles this by trying each stream wholesale first, then
scanning every line of both streams for the last one that parses as JSON.

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
synthesis, and others) is built on the same primitive — `runAgentPrompt()` in `src/llm/runAgent.ts`:

```
config.llm.enabled?  →  No  →  return non-LLM fallback + notice
        │
       Yes
        │
        ▼
shell out to agent CLI with bounded timeout
        │
   ┌────┴────┐
  ok?      timeout / error
   │            │
   ▼            ▼
{ ok: true,  { ok: false,
  text }       reason, detail? }
        │            │
        └─────┬───────┘
              ▼
    caller shows real output or
    non-LLM fallback + clear notice
```

`config.llm.enabled` (default `false`) is the single opt-in gate. The result is always a
discriminated union — callers never catch exceptions for expected failures.

`src/llm/harness.ts`'s `AGENT_CAPABILITIES` table is the single source of truth for what each
agent harness supports — three previously-independent lists in `agent.ts`, `skills.ts`, and
`runAgent.ts` all now derive from it:

| Harness | MCP config write | Skills install | Headless invocation | Native subagents | Live verified |
|---|---|---|---|---|---|
| `claude` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `codex` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `copilot` | ✓ | ✓ | ✓ | ✓ | Partial |
| `cursor` | ✗ | ✓ | ✓ | ✓ | Unverified |

## Review mode

`src/commands/review.ts` dispatches to a reviewer profile loaded from
`.ctxhub/cache/review-profiles.json` (auto-seeded with 5 built-ins on first run). A profile's
`kind` decides how it's answered:

| Kind | How it works | Add new one by… |
|---|---|---|
| `generic` | Freeform LLM persona over the diff/context-pack evidence, guided by `focus` text | Editing the JSON file — no code change |
| `contract` | Reuses `pr-context`'s `reviewContractRisks` unmodified | N/A — only one `contract` persona makes sense |
| `docs` | Reuses `graph --drift`'s `analyzeArchitectureDrift` + `suggestDriftRepairs` unmodified | N/A |

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

## Control plane

The control plane is a set of layered phases, each building on the last. See
[docs/control-plane.md](./control-plane.md) for the full phase-by-phase story.

```
Phase 1  Workspace Registry   ~/.ctxhub/registry.json  — pointer list, no merged indexes
Phase 2  Control-plane service  127.0.0.1:7342  — health, workspaces, status endpoints
Phase 3  Mission Control        GET /  — Fleet, Captains, Knowledge, Config, Skills & Personas, Chat
Phase 4  Execution Profiles    ctxhub.yaml  — persona + harness + model bindings
Phase 5  Central MCP Gateway   ctxhub mcp --central  — routes across registered workspaces
Phase 6  Captains              ~/.ctxhub/captains.json  — scheduled tasks, approval queue
Phase 7  Gateway adapters      src/gateway/  — direct-api (OpenRouter, Ollama, etc.)
```

### Workspace registry

`src/workspaces/registry.ts` holds a user-level pointer list at `~/.ctxhub/registry.json`
(overridable via `CTXHUB_HOME`). It's deliberately thin — `{ name, path, addedAt }` entries only.
Each workspace continues to own its own config/index/memory/personas; the registry never duplicates
or reaches into any of that. `ctxhub workspace list` reports, but never silently prunes, a
workspace whose path no longer exists — the same "report, don't silently fix" bias `ctxhub doctor`
uses for anything destructive.

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
control-plane health can never drift from its `ctxhub doctor` health. An in-process event bus
(`src/events/eventBus.ts`, a plain typed pub/sub — no new dependency) now exists, fed by real
producers (index jobs, Captain runs and handoffs, skill installs, persona syncs) and exposed to
subscribers over Server-Sent Events at `GET /events`. Desktop notifications are one subscriber; the
Mission Control UI's live agent-activity animation and Event Log are another. SSE was chosen over a
real WebSocket because the traffic is one-directional (service → browser) and Node's `http` module
already supports chunked streaming with no extra dependency.

## Mission Control

`src/service/fleetView.ts`'s self-contained HTML page is still served as a no-build fallback, but
`GET /` normally serves a real React/Vite app (`ui/`, built to `ui/dist`) once one has been built —
`src/commands/service.ts`'s `dashboardCommand` (`ctxhub dashboard`) starts the service if needed
(polling `/health` rather than a fixed sleep) and opens it in the browser. The dashboard has six screens sharing one
`GET /events` SSE connection (`ui/src/api/client.ts`'s `useEventStream()` hook) and a Zustand store
(`ui/src/store/fleet.ts`):

- **Fleet** — every registered workspace as a node on a force-directed graph, colored by
  `ctxhub doctor` health, with live index/Captain activity animated as small bots traveling between
  nodes as `index.*`/`captain.*` events arrive over SSE.
- **Captains** — task list, run history, and handoff chains (see below), plus a form to define and
  run new tasks against the live service.
- **Knowledge** — an Obsidian-style force-directed graph built from the real index
  (`src/indexing/knowledgeGraph.ts`): one node per indexed file, no display cap, plus one per
  component extracted from architecture diagrams, similarity edges (via search) and
  diagram-derived relationship edges. Computing similarity edges is the expensive part (one real
  index search per file), so `buildKnowledgeGraph`'s bulk pass only runs it for the
  `MAX_SIMILARITY_NODES` (120) most-recently-indexed files — every file still renders as a node,
  just without similarity edges beyond that budget. Filtering by name highlights and auto-fits
  matches; clicking a node opens a real file-content preview with matches highlighted inline —
  never a synthetic summary — and separately fires `expandKnowledgeGraphNode` (one on-demand
  search, `GET /workspaces/:name/knowledge-graph/expand`), splicing any new edges straight into the
  running d3 simulation. That's what makes the graph genuinely navigable past the initial budget:
  clicking around organically expands coverage outward instead of being stuck with one fixed
  snapshot.
- **Config** — the selected workspace's repos, execution profiles, and knowledge/privacy settings,
  editable live against the same config file the CLI reads.
- **Skills & Personas** — install skills and scaffold/sync personas per harness without leaving the
  browser, reusing the exact `skills install`/`personas sync` logic the CLI commands call.
- **Chat** — ask a selected workspace a question; backed by the same evidence-grounded `explain`
  machinery every other persona-driven command uses, not a separate inference path. Answers render
  through a small hand-rolled markdown renderer (`ChatPanel.tsx` — paragraphs, bullet/numbered
  lists, `**bold**`, `` `code` ``, and `[E1]`-style citation markers; no new dependency for a chat
  sidebar). Each citation resolves against the same `useKnowledgeGraph` data the Knowledge screen
  uses (`repo:path` matching a real node id); a resolving citation is clickable and deep-links to
  Knowledge — switching workspace if needed, selecting the matching node, and opening its real
  content preview via `pendingKnowledgeFocus` in the Zustand store. A citation that doesn't resolve
  (evidence outside the current graph, e.g. truncated out or from another indexed workspace) still
  renders for evidence transparency, just without the click affordance, rather than looking
  clickable and silently doing nothing.

Unlike `ctxhub report`, none of this is a point-in-time snapshot: every screen's inline data comes
from live `fetch` calls plus the shared SSE stream against the running service.

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

`ctxhub captain run <name>` is the manual trigger. `CaptainTask` also supports an optional
`schedule: { everyMinutes }` (`--schedule-every-minutes` on `ctxhub captain add`): the running
`ctxhub service` (`src/commands/service.ts`'s `runForegroundService`) polls task definitions every
60s via `src/captains/scheduler.ts`'s `runDueCaptainTasks`/`isCaptainTaskDue`, computing due-ness
from each task's own most recent pending-run timestamp rather than a separate "last run" state
file. A tick is skipped entirely while a previous poll is still in flight, so an aggressive or slow
poll can never trigger the same task twice concurrently — a real bug along these lines was caught
and fixed while building this (see `docs/control-plane.md`'s Phase 6 section for the story).
Absent a `schedule`, a task stays manual-only, unchanged from before.

Approval gating is real: `runCaptainTask` never writes to a repo, only to a user-level,
non-git-tracked pending-runs queue (`~/.ctxhub/captains/<task>/<runId>.json`, listed via
`ctxhub captain approvals <task>`). The one human-invoked action that promotes a pending run into
a real, team-visible artifact is `ctxhub captain promote <task> <runId> <repo>`, which reuses
`note.ts`'s existing `draftedNoteTemplate` unmodified — the same "AI draft, review before merge"
shape `note add --draft` already produces, not a second promoted-content format.

A task can optionally chain to another via `handoffTo` (`--handoff-to` on `captain add`): once the
source task's evidence-grounded answer is in hand, `runCaptainTask` looks up the named target task
and re-invokes itself against it, folding the source answer in as extra context on the target's
query (`opts.handoffContext` in `src/captains/runner.ts`) and publishing a `captain.handoff` event
the Mission Control UI animates as a bot traveling between the two workspace nodes on the Fleet
graph. Each call in a chain shares one `Set` of already-visited task names, passed down explicitly
rather than tracked globally, so a misconfigured cycle (`A → B → A`) terminates instead of running
forever.

## Gateway adapters

`src/gateway/openaiCompatible.ts` implements Phase 7's top-priority adapter: one generic
OpenAI-compatible client (Node's built-in `fetch`, no new dependency) that in practice covers
OpenRouter, LiteLLM, Portkey, Ollama, and enterprise proxies through a single `baseUrl`, since all
of them speak the same protocol. `ExecutionProfile.runtime` (`src/config/types.ts`) can be
`'direct-api'` instead of a harness name, paired with a `gateway: { baseUrl, apiKeyEnv? }` field —
`apiKeyEnv` names an environment variable holding the API key, never the key itself, so a
workspace's `ctxhub.yaml` never carries a secret even if it's git-tracked.
`runAgentPromptFnForProfile` (`src/execution/executionProfile.ts`) resolves, once per call site,
between the real `runAgentPrompt` (harness CLIs) and a gateway-calling wrapper closed over the
profile's `gateway`/`model` — callers never need to branch per invocation. AWS Bedrock and
Anthropic-direct adapters aren't built; each needs a genuinely different auth/request shape
(SigV4, the native Messages API) that wasn't worth guessing at speculatively.
