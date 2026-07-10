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
`projectInstructions`: a real native subagent file (`.claude/agents/<persona>.md`) for Claude Code,
confirmed live against the actual `claude` CLI; a plain instructions-file fallback for Codex,
Copilot, and Cursor, since none of those are confirmed to have an equivalent native mechanism.
