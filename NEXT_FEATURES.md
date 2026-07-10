# Next Feature Backlog

This is the practical implementation queue for ctxhub ideas that would make the tool more useful for both developers and agents. Each item is intentionally shaped so it can become one focused PR.

## Active Queue

- [x] Report-first memory workspace UX
- [x] Memory provenance and backlinks
- [x] Graph interaction and navigation polish
- [x] MCP write-surface parity for durable memory
- [x] Memory workflow automation and promotion paths
- [ ] Collaborative review mode with built-in reviewer personas
- [ ] Reviewer profiles (custom, pluggable reviewer personas)
- [ ] Harness capability abstraction
- [ ] Evidence-backed confidence scoring
- [ ] OSS adoption kit

Items 6-10 above come from an external competitive/positioning deep-dive
([deep-research-report.md](./deep-research-report.md), a ChatGPT-authored survey of ctxhub against
Copilot, Claude Code, Codex, Cursor, Cody, and several agent frameworks). Its other recommendations
(report-first console, provenance, write-parity, promotion workflows) matched items 1-5 already in
this backlog rather than adding anything new, which is a reasonable independent confirmation that
those five are the right near-term focus.

## Suggested Order

1. Report-first memory workspace UX
2. Memory provenance and backlinks
3. Graph interaction and navigation polish
4. MCP write-surface parity for durable memory
5. Memory workflow automation and promotion paths
6. Collaborative review mode with built-in reviewer personas
7. Reviewer profiles
8. Evidence-backed confidence scoring
9. Harness capability abstraction
10. OSS adoption kit

The first three make the existing graph/memory surface feel like one coherent product instead of a
set of adjacent capabilities. The next two tighten the developer/agent write path so durable
memory is easier to use consistently and easier to explain.

**A genuine disagreement worth surfacing rather than quietly resolving:** the deep-research report
argues review mode should be *first* priority, not sixth — its reasoning is that review unifies a
large fraction of the existing surface (`pr-context`, `ask`/`explain`, graph/architecture evidence,
memory, eval, handoff) and meets a clearer, more marketable user need than workspace-UX polish
does. That's a defensible position. This list keeps 1-5 first anyway, on the theory that a
half-coherent workspace console makes a new review-mode surface harder to discover and trust, not
easier — but this is exactly the kind of sequencing call that should be made deliberately, not by
whichever list happened to get written down first. Worth revisiting once items 1-5 are further
along, or sooner if review feels like the more urgent gap in practice.

## Next Wave Details

The items below describe the current active backlog in more depth. The main opportunity is no
longer raw capability coverage; it is turning the existing pieces into a more coherent, daily-use
workspace console for both developers and agents.

## 22. Report-First Memory Workspace UX

**Status:** Done

**Command:** extend `ctxhub report`

Highest business-case clarity in the current next wave: the features now exist, but the report is
still closer to an artifact than to a workspace console a human would keep open all day.

Developer value:

- Makes the report the obvious place to browse repo context, durable memory, graph structure, and
  timelines without jumping between commands.
- Reduces the "I know the feature exists but I don't remember the flag/tool shape" problem.

Agent value:

- Gives agents a more legible human mirror of the same underlying repo/memory state they already
  retrieve through MCP.
- Makes handoff/debug sessions easier because a user can inspect the same memory/query/timeline
  state visually.

Implementation notes:

- Treat `ctxhub report` as the human control plane rather than just a generated summary page.
- Add in-page controls for memory query, wing, room, and timeline entity instead of requiring the
  user to pre-bake those values into CLI flags.
- Preserve the static, self-contained HTML constraint unless a clearly better local-only option
  emerges.

Acceptance criteria:

- A user can filter memory hits and timeline scope from within the report itself. ✓ (new in-page
  `<select>` controls for wing, room, and timeline entity; wired into the same `render()`/
  `renderTimeline()` filter path the search box already used.)
- A user can move between list, graph, and timeline views without losing their current filter
  context. ✓ (wing/room scope now also hides out-of-scope graph nodes/edges, not just list items;
  the existing view-toggle mechanism was already shared across all three views.)
- No network listener or paid dependency is introduced. ✓ (still one static HTML file; no new
  runtime dependency.)

Implemented per the resolved design fork from the implementation plan: free-text `--memory-query`
still requires regenerating the report (a real new semantic query can't be re-run client-side
against a static file without adding a local server, which would reverse NEXT_FEATURES #4's
"no network listener by default"), and the report's UI copy says so explicitly next to the
controls. Wing/room/timeline-entity, by contrast, are finite/enumerable from data already embedded
at generation time, so those became real in-page filters: the MemPalace timeline is now always
fetched unfiltered (`entity: undefined`) regardless of `--timeline-entity`, with that flag only
pre-selecting the in-page dropdown instead of gating what's embedded. Verified via `report.test.ts`
regex assertions on the generated HTML/embedded JSON, plus a real `ctxhub report --open`-style
render (via `reportCommand` called directly with fixture data, to avoid touching a real MemPalace
palace) opened in an actual browser to confirm the controls render and the hint copy is correct.

## 23. Memory Provenance And Backlinks

**Status:** Done

**Command:** extend `ctxhub report`, `ctxhub memory search`, and memory-related MCP payloads

The business case here is trust: once memory and graph views exist, the next thing users ask is
"where did this come from, and why should I trust it?"

Developer value:

- Every durable memory hit becomes easier to evaluate because source file, writer, timestamp,
  memory type, and related repo artifacts are visible.
- Makes memory safer to use in reviews or debugging because uncertain provenance is obvious.

Agent value:

- Agents can reason about whether a memory item is a diary note, a durable drawer, a checkpoint,
  or a repo note rather than treating all text as equally authoritative.
- Better provenance supports future ranking/tie-break decisions without inventing confidence.

Implementation notes:

- Normalize provenance fields across report items, graph nodes, `memory_search`, and timeline
  events.
- Surface explicit links between repo notes, architecture docs, source files, and memory items when
  they mention the same repo/path/wing/room.
- Keep it read-only: this is a metadata and navigation improvement, not a new storage engine.

Acceptance criteria:

- Memory hits and timeline events expose consistent provenance fields wherever they appear. ✓
  (`ReportItem`/`ReportGraphNode` gained `sourceFile?`/`timestamp?`; `reportMemorySearchItems`
  populates them from `MempalaceSearchHit.source_file`/`created_at`.)
- The report graph can show explicit cross-links between memory and repo artifacts when evidence
  exists. ✓ (new `'documented-by'` edge type; `buildProvenanceBacklinks()` matches a memory hit's
  `sourceFile` against `architecture`/`recent` items, exact `repo:path` first, falling back to a
  path-only match across repos.)
- Users can tell whether a fact came from MemPalace, a git-tracked note, a diagram, or indexed
  source/doc context. ✓ (existing `section`/node-class distinctions were already sufficient; this
  item only added the missing source-file/timestamp/backlink layer on top.)

Implemented as a pure function (`buildProvenanceBacklinks(items): ReportGraphEdge[]` in
`report.ts`), no LLM involved. Writer/`added_by` provenance was deliberately descoped: a live check
against a real MemPalace palace earlier this session confirmed `searchMempalace` results carry no
writer field on read (only `addDrawerMempalace` accepts one on write), so there is nothing to
surface here without a MemPalace-side change. Verified with unit tests only (pure data
transformation, no CLI/LLM boundary to smoke-test) -- exact match, wing-mismatch path-only
fallback, and no-match cases, plus an integration test through `buildReportGraphData`.

## 24. Graph Interaction And Navigation Polish

**Status:** Done

**Command:** extend `ctxhub report`

The current graph proves the model; the next business case is making it genuinely useful rather
than merely inspectable.

Developer value:

- Makes it faster to focus on one repo, one memory wing, or one architecture neighborhood.
- Turns the graph into a navigation aid instead of a static visualization.

Agent value:

- Supports more precise human-guided debugging of what an agent saw or missed.
- Creates a clearer shared view during pair-debugging or handoff sessions.

Implementation notes:

- Add pin/focus behavior for a selected node and its immediate neighborhood.
- Add graph-side filters for node classes (repo/file/component/memory wing/memory room/memory hit).
- Add better detail panels for edges and a compact way to jump from a selected node to a related
  command or file path.

Acceptance criteria:

- A user can focus the graph on a node neighborhood without visually losing the rest of the page. ✓
  (a "Focus on selected node's neighborhood" toggle dims, rather than hides, everything outside the
  selected node's immediate neighbors, so the rest of the graph stays visible as context.)
- A user can hide low-signal node classes when investigating one slice of the workspace. ✓ (the
  graph legend swatches are now checkboxes -- unchecking a class actually hides those nodes/edges,
  reusing the existing `.hidden` filter mechanism.)
- Selected nodes and edges expose enough metadata to support the next action, not just inspection.
  ✓ (edges are now clickable and populate the detail panel with their endpoints/type; a file node's
  panel shows a resolved absolute path plus a `file://` "Open" link.)

Implemented in the same embedded `<script>` block #22 touched, per the plan's sequencing note.
Repo nodes now carry an absolute filesystem path (`path.resolve(workspaceRoot, repo.path)`, done
once in `reportCommand`) so the client can join it with a file node's repo-relative path into a
real, working link without any new backend call. Verified via `report.test.ts` (markup/behavior
regex assertions, an edge-selection/jump-link-focused test, and a real syntax-validity check of the
extracted client script) plus a real `reportCommand` render opened in an actual browser. One real
bug was caught and fixed along the way: the client-side jump-to-file trimming regexes
(`/\/+$/`/`/^\/+/`) are embedded as literal text inside `report.ts`'s own outer template literal, so
writing them with a single backslash let the outer template literal's string-escape processing
silently eat the backslash (`\/` is a no-op escape in a JS string, same class of bug as the earlier
`</script>` escaping fix this session) -- collapsing to `//+$/` in the emitted HTML, which the
browser then parses as a comment rather than a regex, throwing a real `SyntaxError`. Fixed by
doubling the backslash in the TS source (`/\\/+$/`) so the emitted browser code keeps a single
backslash; caught by ESLint's `no-useless-escape` and confirmed as a real (not cosmetic) break via
a revert-and-confirm-fail regression test before restoring the fix.

## 25. MCP Write-Surface Parity For Durable Memory

**Status:** Done

**MCP:** extend `ctxhub mcp`

The business question here is consistency: today users have `ctxhub memory add`/`diary`, while
agents have raw MemPalace MCP write tools and ctxhub MCP read tools. That split works, but it is
not yet one coherent surface.

Developer value:

- Gives teams one stable tool family to document and teach, rather than mixing ctxhub read tools
  with raw MemPalace write names.
- Makes future auditing/telemetry of memory operations easier because the calls flow through one
  visible surface.

Agent value:

- Reduces cognitive overhead: agents can use one ctxhub-shaped memory surface for read and write.
- Makes wing/room-aware memory filing easier to standardize in skills and system prompts.

Implementation notes:

- Consider adding thin MCP wrappers for the existing `ctxhub memory add` and `ctxhub memory diary`
  passthroughs rather than exposing a second memory engine.
- Keep the wrappers honest and explicit: they should forward into MemPalace and say so.
- Decide whether these tools stay always-on or remain an opt-in/mutating surface like index/sync.

Acceptance criteria:

- Agents can file durable memory through ctxhub-shaped MCP tools without losing wing/room control. ✓
  (`memory_add(content, wing, room, source_file?, added_by?)`, `diary_write(entry, agent_name,
  topic?, wing?)`.)
- The wrappers are clearly documented as passthroughs to MemPalace, not a second storage system. ✓
- The read/write split between ctxhub and MemPalace becomes simpler, not more confusing. ✓ (one
  ctxhub-shaped tool family for both read and write, same wing/room vocabulary throughout.)

Implemented as a **separate** opt-in gate from `--allow-index`: `ctxhub mcp --allow-memory-write`.
Deliberately not reusing `--allow-index` -- re-indexing this workspace's own content and writing to
a user's durable MemPalace memory are different kinds of mutation, and allowing one shouldn't
silently allow the other. Both tools are thin passthroughs to the already-existing
`addDrawerMempalace`/`writeDiaryMempalace` (now fixed, see the 2026-07-10 update below), following
the exact `if (opts.allowX) { registerTool(...) }` precedent already used for
`index_workspace`/`sync_workspace`. Verified via a real MCP client/server round trip
(`InMemoryTransport`, not a mock of the MCP layer) with injected backend functions -- the
underlying MemPalace calls themselves were already proven against a real palace while fixing the
stdout/stderr bug below, so this item's testing focused on the new wiring, not repeating that.

**2026-07-10 update:** before building this, a real bug was found and fixed in the underlying
passthroughs this item would wrap. `timelineMempalace`/`addDrawerMempalace`/`writeDiaryMempalace`
all route through `mempalace.mcp_server`'s internal functions, which redirect stdout for
MCP-protocol hygiene -- so their JSON result (and often extra log noise) landed on stderr instead,
and `runMempalaceJson()` only ever parsed stdout. All three silently failed with "MemPalace
returned invalid JSON output" on every real call; only `searchMempalace` worked (it calls
`mempalace.searcher` directly, a module without that redirection). Fixed in
`src/memory/mempalaceCli.ts` via `extractJsonPayload()`: try each whole stream first, then fall
back to scanning every line of both streams and keeping the last one that parses as JSON (the
`print(json.dumps(...))` call is always the final statement in every script). Verified against a
real MemPalace palace -- `timelineMempalace` now returns real data instead of the error. Whatever
builds #25 should specifically re-verify the write paths (`add`/`diary`) live too, since this
session's fix was only re-verified against the read-only timeline path to avoid writing more test
data into a real palace.

## 26. Memory Workflow Automation And Promotion Paths

**Status:** Done

**Command:** extend `ctxhub memory`, `ctxhub note`, and `ctxhub handoff`

This is the highest leverage follow-up after the primitives: users should not have to manually
decide every time whether something belongs in a drawer, a diary, a repo note, or both.

Developer value:

- Reduces friction around capturing useful knowledge in the right place.
- Helps teams promote durable memory into reviewable repo notes when it graduates from private
  memory to shared documentation.

Agent value:

- Gives agents a safer workflow for checkpointing, storing decisions, and later promoting them to
  codebase-facing notes or diagrams.
- Reduces repeated re-synthesis of the same insight across sessions.

Implementation notes:

- Add higher-level flows on top of the existing memory and note primitives:
  - save a session checkpoint from current context
  - suggest a wing/room for a memory write
  - promote a memory item into a git-tracked repo note
  - summarize several diary/checkpoint entries into one shared artifact
- Keep the current split intact: MemPalace remains durable/private by default, repo notes remain
  shared/reviewable by default.

Acceptance criteria:

- A user or agent can move a useful insight from ephemeral work into durable memory with fewer
  manual decisions. ✓ (`ctxhub memory add <content>` now auto-suggests a wing/room from existing
  rooms -- best keyword-overlap match, falling back to a `notes` room under the current repo/
  workspace -- when `--wing`/`--room` are omitted; `ctxhub memory checkpoint [note] --agent <name>`
  auto-assembles a diary entry from the current git branch/recent commits plus an optional note.)
- A user or agent can promote durable memory into a repo note without copy/paste churn. ✓
  (`ctxhub note promote <repo> <query> [--wing] [--room] [--hit] [--title] [--agent]` searches
  MemPalace, copies the matching hit's text verbatim into a new git-tracked note under
  `<repo>/agent-notes/`, and records a `promoted-from: mempalace:<wing>/<room>` frontmatter field
  for traceability.)
- The workflow makes the boundary between private memory and team-shared notes clearer, not
  blurrier. ✓ (promotion is an explicit, one-way copy -- the original MemPalace drawer is untouched
  -- documented in the README's "Two kinds of agent memory" section right next to the existing
  `note add` explanation, not as a separate concept.)

Descoped: "summarize several diary/checkpoint entries into one shared artifact" from the
implementation notes was not built. It wasn't a hard acceptance criterion, and building it well
needs a way to list/enumerate an agent's own past diary/checkpoint entries, which the current
MemPalace search/timeline surface doesn't cleanly support (search is similarity-based, not a
"list entries for agent X" query) -- worth a follow-up once that read path exists, rather than
building a summarizer around a shaky enumeration heuristic today.

All three flows are deterministic (no LLM/`runAgentPromptFn` involved, unlike most other
LLM-backed features in this codebase) -- wing/room suggestion and promotion are both pure
text/data operations, and checkpoint assembly is plain git log formatting. Verified via unit
tests (`suggestMemoryLocation`, `memoryAddCommand`/`memoryCheckpointCommand`/`notePromoteCommand`
with injected fakes) plus a real end-to-end run of all three commands against an actual MemPalace
palace scoped to a disposable scratch workspace (`.ctxhub/memory/mempalace`, not the user's real
`~/.mempalace` store).

## 27. Collaborative Review Mode With Built-In Reviewer Personas

**Status:** Not started

**Command:** new `ctxhub review <topic>`, likely extending `ctxhub pr-context`

**Source:** [deep-research-report.md](./deep-research-report.md) — flagged as the single clearest
gap versus commercial tools (Copilot code review, Cursor Bugbot, Claude/Copilot GitHub Actions
review), and the recommendation most other items in this list are absent without.

Developer/agent value:

- Turns several already-shipped primitives (`pr-context`'s contract-risk review, `graph --drift`,
  eval, handoff, architecture search) into one named workflow instead of a list of separate
  commands a user has to already know to reach for.
- Gives a repeatable, explainable answer to "review this change" instead of an ad hoc combination
  of tools.

Implementation notes:

- Built-in reviewer personas to start with (per the report): bug hunter, contract reviewer
  (already has real substance via #13's cross-repo risk review), security reviewer, performance
  reviewer, docs/diagram reviewer (pairs with `validate docs`/`graph --drift`).
- Each persona is really just a distinct `runAgentPrompt` prompt template plus a choice of which
  existing evidence sources to pull from (context pack, diff, architecture graph, eval history) --
  this is orchestration over existing primitives, not a new evidence engine.
- Requires `llm.enabled`, same as every other LLM-backed feature; without it, fall back to
  printing the raw evidence bundle each persona would have used (mirrors `pr-context`'s existing
  disabled-path behavior).
- Never invents findings beyond the evidence it was given -- same citation discipline as
  `explain`/`pr-context`/`handoff`.

Acceptance criteria:

- `ctxhub review <topic> --as <persona>` (or similar) produces persona-specific findings grounded
  only in real evidence, with citations.
- Falls back to a plain evidence bundle, not an error, when `llm.enabled` is false.
- At least the contract-reviewer persona can reuse #13's existing risk-review logic directly
  rather than reimplementing it.

## 28. Reviewer Profiles

**Status:** Not started

**Command:** extend `ctxhub review` (from #27)

**Source:** [deep-research-report.md](./deep-research-report.md) — "how you get from 'cool demo'
to 'workflow primitive'."

Developer/agent value:

- Makes review mode extensible without a code change per new reviewer: a team can define its own
  reviewer (e.g. "our API style guide reviewer") the same way `ctxhub eval`'s suite is a JSON file
  a team edits, not a hardcoded list.

Implementation notes:

- A reviewer profile encodes: prompt/persona instructions, which evidence sources it prioritizes
  (context pack, diff, architecture graph, eval history), and expected output shape.
- Store profiles the same way `ctxhub eval`'s suite lives in `.ctxhub/cache/` -- a reviewable,
  editable JSON/YAML file, not a database.
- Depends on #27 existing first; this is explicitly a follow-up, not bundled into the same PR.

Acceptance criteria:

- A team can add a new reviewer persona by editing a file, without a ctxhub code change.
- Built-in personas from #27 are expressed using the same profile shape, not a separate mechanism.

## 29. Harness Capability Abstraction

**Status:** Not started

**Refactor:** `src/commands/agent.ts`, `src/commands/skills.ts`, `src/llm/runAgent.ts`

**Source:** [deep-research-report.md](./deep-research-report.md) — noted that harness support
today is "partial": `agent.ts`'s `SUPPORTED_AGENTS` (MCP config writing), `skills.ts`'s
`SUPPORTED_SKILL_AGENTS` (skill install), and `runAgent.ts`'s `LLM_AGENTS` (headless invocation)
are three separate, not-quite-aligned lists (confirmed this session while building the LLM
infra -- cursor is deliberately absent from `SUPPORTED_AGENTS` since it has no MCP-config-writing
support yet, for instance).

Developer/agent value:

- Makes it clearer, in one place, what "supporting a harness" actually means (MCP config? skill
  install? headless LLM invocation? all three?), instead of three lists that happen to overlap.
- Lowers the bar for a community contribution adding a new harness.

Implementation notes:

- Model each harness's capabilities explicitly (e.g. `{ mcpConfig: boolean; skills: boolean;
  headlessInvocation: boolean }`) rather than three independent string-literal union types that
  must be kept in sync by convention.
- This is an internal refactor, not a new user-facing surface -- low risk of behavior change if
  done as a pure consolidation of the existing three lists.
- Explicitly not urgent: correctness doesn't depend on it, only contributor ergonomics do.

Acceptance criteria:

- Adding a new harness (or a new capability to an existing one) requires touching one place, not
  three independently-maintained lists.
- No behavior change for `claude`/`codex`/`copilot`/`cursor` support as it exists today.

## 30. Evidence-Backed Confidence Scoring

**Status:** Not started

**Depends on:** #23 (Memory Provenance And Backlinks)

**Source:** [deep-research-report.md](./deep-research-report.md) — explicitly framed as
provenance-derived, not model self-confidence: "you are right not to invent confidence... an
evidence score based on number of corroborating repos, recency, doc/code agreement, and source
type would be genuinely useful."

Developer/agent value:

- Lets a user or agent triage many results by more than raw lexical score -- e.g. prefer a claim
  corroborated by both a doc and the actual source over one mentioned in a single stale note.
- Useful directly in review mode (#27) and handoff for flagging shaky evidence explicitly.

Implementation notes:

- Explicitly not a new confidence *model* -- a scoring function over signals #23 already
  surfaces: number of independent corroborating sources, recency, doc/code agreement, source type
  (durable memory vs. git-tracked note vs. raw source).
- Must not require an LLM call -- this should be cheap, deterministic, and available even with
  `llm.enabled: false`.

Acceptance criteria:

- Score is computed from real, inspectable signals; a user can see why a result scored the way it
  did, not just the number.
- Available without `llm.enabled`.
- Does not block on or require #27/#28 to land first, only #23.

## 31. OSS Adoption Kit

**Status:** Not started

**Scope:** packaging, docs, examples -- not a single command

**Source:** [deep-research-report.md](./deep-research-report.md) — rated low-medium complexity,
high value; "probably the highest ROI community move after review mode."

Developer value:

- Lowers the barrier from "clone, build, link" to an actual install, which the report calls out
  as a concrete, current adoption barrier.
- A reference multi-repo workspace and a "why ctxhub?" example give a new user something to run
  in five minutes instead of reading the whole command list first.

Implementation notes:

- Revisit the existing "npm publishing intentionally disabled until ready to ship" note in
  [ROADMAP.md](./ROADMAP.md) -- this item is the point at which that gate is deliberately
  reconsidered, not a silent reversal of it.
- A small reference workspace (2-3 toy repos with docs, an architecture diagram, and a couple of
  MemPalace-style notes) that a new user can `ctxhub onboard` against immediately.
- Split docs along the lines the report suggests: philosophy (why this shape of tool), quickstart
  (fastest path to first value), architecture (how it actually works) -- rather than one long
  README carrying all three jobs.

Acceptance criteria:

- A new user can go from clone to a working, demonstrable multi-repo setup in one short quickstart
  pass.
- Publishing (npm/Homebrew) is a deliberate decision made when picking this item up, not implied
  by simply writing this entry.

## Completed Archive

Everything below this point is shipped. Keep it as design history, implementation notes, and
acceptance-criteria reference rather than as the active to-do list.

## 1. Cited Explain Command

**Status:** Done

**Command:** `ctxhub explain <query>`

Generate a concise, cited answer from an agent-ready context pack. This should sit one level above `ctxhub pack`: `pack` gathers the evidence, while `explain` turns it into a readable answer with source references.

Developer value:

- Faster orientation without manually reading every search result.
- Useful in terminal workflows before opening an agent session.
- Produces copyable, reviewable summaries for PRs or docs.

Agent value:

- Gives agents a structured baseline answer before deeper tool use.
- Encourages citation-backed responses instead of free-form guessing.

Implementation notes:

- Start with a non-LLM version: print the top context items grouped by repo, freshness, diagram relationships, and suggested reading order.
- Later add an optional provider-backed summarizer, gated behind config.
- Keep output citation-first: include repo, path, chunk id, and freshness.

Acceptance criteria:

- `ctxhub explain "auth flow"` returns a readable answer scaffold.
- `--json` returns the same data as structured fields.
- It never invents citations; every claim maps to indexed context.

## 2. CI Workflow Templates

**Status:** Done

**Command:** `ctxhub ci init`

Scaffold GitHub Actions workflows that run ctxhub checks on pull requests.

Developer value:

- Keeps docs, diagrams, and search quality from drifting silently.
- Makes architecture notes and `.mmd` diagrams part of the normal review loop.

Agent value:

- Agents can add docs/diagrams and immediately know which checks will validate them.
- Failed checks give agents concrete feedback to repair.

Implementation notes:

- Add `.github/workflows/ctxhub.yml`.
- Run `npm ci`, `npm run build`, `ctxhub validate docs`, and optionally `ctxhub eval`.
- Support flags:
  - `--force` to overwrite.
  - `--with-eval` to include eval checks.
  - `--package-manager npm|pnpm|yarn` if needed later.

Acceptance criteria:

- New command creates an idempotent workflow.
- README documents how to enable/disable evals in CI.
- Existing user workflows are not overwritten unless `--force` is used.

## 3. Context Pack Export And Replay

**Status:** Done

**Commands:** `ctxhub pack --out <file>`, `ctxhub replay <file>`

Save context packs as portable artifacts that can be attached to PRs, shared with teammates, or used to debug agent answers after the fact.

Developer value:

- Makes "what did the agent see?" inspectable.
- Helps reproduce bad or surprising agent answers.
- Useful for PR review: attach the context bundle used to make a recommendation.

Agent value:

- Agents can resume from an exact context snapshot.
- Multiple agents can compare against the same evidence.

Implementation notes:

- Add metadata: ctxhub version, workspace name, createdAt, query, cwd, repo HEADs.
- `replay` should print the pack summary and optionally open chunk ids that still exist locally.
- Consider redacting absolute paths unless `--include-absolute-paths` is passed.

Acceptance criteria:

- Exported JSON validates against a documented shape.
- `ctxhub replay pack.json` works even if the live index changed.
- Freshness warnings are clear when replayed chunks no longer match current HEAD.

## 4. Interactive Workspace Viewer

**Status:** Done (as a static report; no local server was needed — see notes)

**Command:** `ctxhub report [-o <path>]`

Launch a lightweight local viewer for browsing workspace status, repos, diagrams, context packs, search results, and stale index information.

Developer value:

- Makes ctxhub easier to demo and understand.
- Gives teams a visual map of docs, architecture, and indexed knowledge.
- Helps find stale or missing context before it affects agents.

Agent value:

- The viewer can become a human-friendly mirror of the MCP surfaces agents already use.
- Easier to debug why an agent did or did not find something.

Implementation notes:

- Start with a static generated HTML report upgrade before adding a server.
- Candidate path:
  1. Improve `ctxhub report` with richer sections.
  2. Add search/filter client-side JavaScript.
  3. Add `ctxhub ui` as a local server only if static output becomes limiting.
- Include architecture diagrams rendered from Mermaid if dependency weight is acceptable.

Acceptance criteria:

- Viewer shows repos, index status, architecture diagrams, recent chunks, and stale results. ✓ (`ctxhub report` now shows all of these; freshness/staleness reuses the same per-repo Git check as `pack`/`explain`/`handoff`.)
- Works without external services. ✓ (single self-contained HTML file, vanilla JS, no CDN assets.)
- Does not expose a network listener by default unless explicitly requested. ✓ (there is no server — `ctxhub ui` was not built since the static report plus client-side search/filter covers the acceptance criteria; add a local server later only if static output actually becomes limiting.)

## 5. Rich Mermaid Validation

**Status:** Done

**Command:** extend `ctxhub validate docs`

Validate Mermaid diagrams beyond simple declaration checks.

Developer value:

- Catches broken diagrams before PR review.
- Makes architecture docs more trustworthy as indexed context.

Agent value:

- Agents can create diagrams and get actionable syntax feedback.
- Diagram search/map quality improves when invalid diagrams are caught early.

Implementation notes:

- Evaluate Mermaid CLI or parser dependency.
- Keep the current lightweight validator as the default if Mermaid adds too much install weight.
- Add optional mode: `ctxhub validate docs --strict-diagrams`.
- Consider rendering diagrams in CI as artifacts later.

Acceptance criteria:

- Invalid Mermaid syntax is reported with file and useful message.
- Strict mode is documented separately from the default fast validation.
- Existing lightweight validation remains quick and dependency-light.

## 6. Architecture Drift Detection

**Status:** Done

**Command:** `ctxhub graph --drift`

Compare indexed architecture diagrams against configured repos and package metadata to find missing, stale, or suspicious relationships.

Developer value:

- Surfaces diagrams that no longer match repo reality.
- Helps teams keep architecture maps useful over time.

Agent value:

- Gives agents a stronger system model and flags uncertainty explicitly.
- Helps agents propose doc updates when they change code.

Implementation notes:

- Detect components in diagrams that do not match configured repos or package names.
- Detect configured repos with no architecture representation.
- Detect relationships pointing to unknown components.
- Later, compare imports/package dependencies to diagram relationships.

Acceptance criteria:

- `ctxhub graph --drift --json` returns components, relationships, and drift findings.
- Human output groups findings by severity.
- Warnings do not fail by default; add `--fail-on-drift` for CI.

## 7. Agent Handoff Bundles

**Status:** Done

**Command:** `ctxhub handoff <topic>`

Create a handoff markdown file for another agent or teammate, combining context pack, current repo freshness, changed files, diagrams, and next suggested actions.

Developer value:

- Useful at the end of a work session.
- Makes cross-agent or human-agent collaboration less lossy.

Agent value:

- Gives a clean "start here" artifact for continuation.
- Reduces repeated rediscovery across sessions.

Implementation notes:

- Output default: `.ctxhub/cache/handoffs/<timestamp>-<slug>.md`.
- Include optional `--repo <name>` and `--out <path>`.
- Consider `--from-pr` to incorporate `ctxhub pr-context`.

Acceptance criteria:

- Handoff file includes query/topic, top context, repo status, freshness, architecture notes, and next steps.
- Uses relative paths where possible.
- Does not write to team docs unless explicitly asked.

## 8. Config Doctor Fix Mode

**Status:** Done

**Command:** `ctxhub doctor --fix`

Let doctor repair safe, mechanical issues.

Developer value:

- Reduces setup friction.
- Makes upgrades smoother when config shape or skill templates evolve.

Agent value:

- Agents can recommend one deterministic command rather than a manual checklist.

Implementation notes:

- Safe fixes only:
  - Create missing `.ctxhub` directories.
  - Add default privacy config if missing.
  - Reinstall stale skills when requested.
  - Refresh agent MCP config with `--fix-agent <name>` or similar.
- Avoid modifying user-authored hooks or repo lists automatically.

Acceptance criteria:

- Dry-run mode explains intended changes.
- `--fix` only performs low-risk operations.
- Any potentially invasive fix requires an explicit flag.

## 9. Search Quality Dashboard

**Status:** Done

**Command:** extend `ctxhub eval`

Turn golden query evals into a trendable report.

Developer value:

- Shows whether indexing/search changes improve or degrade real queries.
- Helps tune ranking boosts with evidence.

Agent value:

- Gives agents predictable retrieval behavior over time.

Implementation notes:

- Add `ctxhub eval --report`.
- Track pass/fail, expected paths, actual ranks, missing expected results, and score deltas.
- Consider storing historical eval runs in `.ctxhub/cache/evals/`.

Acceptance criteria:

- Eval report works as JSON and HTML/Markdown.
- Failure output includes enough detail to tune ranking.
- CI can fail on regression.

## 10. Source-Aware Context Expansion

**Status:** Done

**MCP/CLI:** extend `get_file_context` and `open_chunk`

Make exact context expansion smarter for code files.

Developer value:

- Opens the containing function/class rather than arbitrary line windows.
- Reduces manual file navigation.

Agent value:

- Agents get semantically complete code context with fewer tool calls.

Implementation notes:

- Start with TypeScript/JavaScript using a parser or lightweight syntax heuristics.
- Add `symbol` metadata during indexing where practical.
- Extend `get_file_context` with `symbol` or `mode: "semantic"`.

Acceptance criteria:

- Given a line inside a function, context expansion returns the full function when possible. ✓ (`src/context/symbols.ts` heuristically brace-matches function/method/class/arrow-function boundaries in TS/JS/JSX; `get_file_context` uses it by default.)
- Falls back to current before/after line behavior when parsing fails. ✓ (no recognizable enclosing symbol, or a non-source file, both fall back to the original line-window logic unchanged.)
- MCP schema stays backwards compatible. ✓ (`get_file_context` gained an optional `mode` input and an optional `symbol` output field only; existing callers passing the old params get the old-shaped fallback unless a symbol match applies.)
- Bonus: indexing itself now chunks TS/JS/JSX source by top-level symbol (`chunkSourceCode` in `src/indexing/chunk.ts`) instead of blank-line paragraphs, so `search`/`open_chunk` results for code are already whole functions/classes with `symbol`/`symbolKind` metadata, not arbitrary slices.

## LLM-Backed Feature Backlog

All items below ride on the LLM opt-in infrastructure already built (`src/llm/runAgent.ts`'s
`runAgentPrompt`/`LLM_AGENTS`/`llmDisabledNotice`, the `llm` config section, and the `llm-features`
doctor check) and the flagship that proved it end-to-end (LLM-backed `ctxhub explain`). Each one:
gates its LLM path behind `config.llm.enabled`, always falls back to a non-LLM behavior when
disabled/unavailable/timed out, and never invents information beyond what it was given. Sequenced
roughly by validated confidence and value (see `SUBAGENTS_BRAINSTORM.md`'s scorecard), not by file
order. Items 11-21 below are now implemented; the sections remain here as a shipped record and as
design context for the next wave.

## 11. Agent-Backed Skill/Doc Test Reports

**Status:** Done

**Command:** `ctxhub eval --agent-report`

The most validated idea in this backlog — this session repeatedly did a manual version of it
against the real VF3 workspace and found genuine skill/doc gaps each time.

Developer value:

- Continuous QA on whether agents actually reach for the right ctxhub tool, instead of finding
  out from a frustrated teammate.

Agent value:

- Skill/doc regressions get caught before they reach a real session, not after.

Implementation notes:

- Extend `src/commands/eval.ts`'s existing `EvalSuite`/`EvalCase` shape (or a sibling suite file)
  with a set of realistic natural-language questions (not just repo/path expectations).
- For each question, invoke `runAgentPrompt` with a prompt instructing the configured agent CLI to
  act as if it were answering the question using ctxhub's skill docs/tools, then have it report
  which tool(s) it would reach for and why.
- Compare against an expected tool/approach per question; write findings in the same report format
  `writeEvalReport`/`renderEvalMarkdown` already produce.
- Requires `llm.enabled`; without it, `--agent-report` should explain why it's unavailable
  (`llmDisabledNotice`) rather than silently doing nothing.

Acceptance criteria:

- `ctxhub eval --agent-report` produces a markdown report naming which questions the agent
  answered with the expected tool vs. not. ✓
- Falls back with a clear message when `llm.enabled` is false or no agent CLI is available. ✓
  (`llmDisabledNotice('agent tool-choice reports')` when disabled; per-case `error` field with the
  `runAgentPrompt` failure reason otherwise.)
- Report format is consistent with the existing `ctxhub eval --report` dashboard. ✓ (same
  `.ctxhub/cache/evals/` directory, `agent-<timestamp>.md`/`agent-latest.md` naming.)
- Verified against the real VF3 workspace: found a genuine, real mismatch (the model defaults to
  `context_pack` even for architecture/implementation-lookup questions where the skill docs
  recommend `architecture_search`/`search`) — the tool caught exactly the kind of gap it exists to
  catch, on its first real run.

## 12. Onboarding Orientation Narrator

**Status:** Done

**Command:** extend `ctxhub onboard` / new `ctxhub explain --orient`

Highest business-case clarity in this backlog: faster time-to-productivity for a new engineer
joining a repo or team.

Developer value:

- A new hire gets a synthesized narrative of architecture, ownership, and recent activity instead
  of a list of commands to run themselves.

Agent value:

- Gives an agent a ready-made "here's what this workspace is" briefing to hand a new session.

Implementation notes:

- Runs after `src/tui/onboardFlow.ts`'s existing steps complete (repos discovered, index built).
- Build a prompt from `createContextPack`'s repo list, architecture results, and recent
  `ctxhub graph` output; ask the configured agent CLI to narrate what this workspace is and how
  it fits together, citing repos/files it actually saw.
- Requires `llm.enabled`; without it, ends with today's plain "onboarding complete" summary.

Acceptance criteria:

- Narrative cites real repos/architecture results, never invents ones that don't exist. ✓
  (prompt explicitly instructs "cite only these repo:path pairs... never invent one" and hedges
  when evidence is sparse, mirroring `ctxhub explain`'s citation discipline.)
- Onboarding completes successfully with the existing plain summary when LLM synthesis is off. ✓
- Falls back to a clear warning (not a crash) when the LLM call fails/times out. ✓

Implemented in `src/tui/onboardFlow.ts` as the final step before the completion banner, gated on
`config.llm.enabled` with `llmDisabledNotice` shown when off. Full branch coverage (disabled,
success, failure) in `onboardFlow.test.ts` via injected `createContextPack`/`runAgentPrompt`
fakes -- the underlying calls were already verified live against the real `claude` CLI as part of
the `ctxhub explain` flagship, so this item didn't need a second live-CLI smoke test, just proof
the new integration glue calls them correctly in each branch.

## 13. Cross-Repo Contract-Break PR Reviewer

**Status:** Done

**Command:** extend `ctxhub pr-context`

Developer value:

- Flags a breaking change's blast radius across sibling repos before it ships, not after an
  incident.

Agent value:

- Turns "here are the changed files" into "here's who this might break."

Implementation notes:

- `src/commands/prContext.ts`'s `prContextCommand` already gathers changed files vs. a git base
  and a context pack; feed the diff + context pack to `runAgentPrompt`, asking it to name likely
  downstream consumers (via `architecture_map`/`search` results) and specific contract risks.
- Requires `llm.enabled`; falls back to today's plain changed-files/context-pack output.

Acceptance criteria:

- Only flags consumers actually found via ctxhub's index, never invented ones. ✓ (parsed
  `REPO:`/`RISK:` blocks are dropped unless the named repo is in the actual candidate list; test
  confirmed to fail without this filter before being trusted.)
- `--json` output includes the flagged risks as structured data, not just prose. ✓ (`risks: [{
  repo, risk }]`, only present when non-empty.)

Verified against a real scratch two-repo workspace: renamed an exported function in one repo
without a compatibility shim, and the reviewer correctly named the specific consuming repo and
described the exact break (old name, new name, "breaking the import at build/runtime") grounded
in the real diff content, not a guess from file names alone.

## 14. Architecture/Doc Drift Repair Suggestions

**Status:** Done

**Command:** extend `ctxhub graph --drift`

Developer value:

- Architecture diagrams stay accurate without someone manually noticing they've gone stale.

Agent value:

- Turns a drift warning into an actionable suggested fix instead of just a flag.

Implementation notes:

- `ctxhub graph --drift` already detects diagrams/docs that no longer match repo reality; for each
  finding, feed the drifted diagram plus current code to `runAgentPrompt` and ask for a suggested
  diff, output via the existing `ctxhub diagram add` scaffolding conventions.
- Never auto-applies — always a suggestion for human/agent review.
- Requires `llm.enabled`; without it, `--drift` behaves exactly as it does today.

Acceptance criteria:

- Suggested diffs are diffs against the real current diagram content, not full rewrites. ✓ (a
  simple line-membership diff, not a true positional unified diff -- good enough for short
  Mermaid files; see the code comment on `lineDiff` in `graph.ts` for why `git diff --no-index`
  wasn't used instead: it exits 1 whenever there ARE differences, the normal case here, which
  would need special-casing against execa-lite's reject-on-nonzero convention.)
- `--fail-on-drift` (CI) behavior is unaffected — this only adds a suggestion, never blocks. ✓
- Scoped to `unknown-component`/`unknown-relationship-endpoint` findings only, since those have an
  existing diagram file to diff against; `unrepresented-repo` findings have no diagram at all (a
  new file, not a diff) and are left out of scope here.

Verified against a real scratch workspace: a diagram naming a component "Billing" that didn't
match the actual repo name "billing-service" was correctly identified and the suggested repair
renamed only that component, preserving the rest of the file, exactly as instructed. Two separate
findings tracing back to the same diagram file correctly deduped to one suggestion, not two.

## 15. PR/Handoff Description Synthesis

**Status:** Done (scoped to `ctxhub handoff`)

**Command:** extend `ctxhub handoff` / `ctxhub pr-context`

Developer value:

- Saves real per-PR time and produces more consistent description quality across a team.

Agent value:

- Gives agents a drafted description to review/edit instead of writing one from scratch each time.

Implementation notes:

- Both `src/commands/handoff.ts` and `src/commands/prContext.ts` already assemble the raw
  material (diff, context pack, changed files) via template string concatenation; add an LLM path
  that feeds the same material to `runAgentPrompt` for a synthesized description, output alongside
  (not instead of) the existing structured sections.
- Requires `llm.enabled`; falls back to today's templated bundle.

Acceptance criteria:

- Synthesized description cites only files/evidence already present in the bundle. ✓ (prompt
  explicitly instructs "cite only these repo:path pairs, never invent one," same discipline as
  the explain flagship and the onboarding narrator.)
- Adds a new `## Summary` section to the handoff markdown, alongside the existing structured
  sections, not replacing any of them. ✓

Scoped to `ctxhub handoff` only, not `ctxhub pr-context` -- pr-context already got its own
LLM-backed feature in #13 (cross-repo contract-risk review), and adding a second, different kind
of synthesis on top of that felt like scope creep rather than a clearly distinct need. No `--json`
flag exists on `ctxhub handoff` today (it always writes a markdown file), so that half of the
original acceptance criterion didn't apply as written.

## 16. Auto-Drafted Note/Diagram Content

**Status:** Done

**Command:** extend `ctxhub note add` / `ctxhub diagram add`

Developer value:

- Lowers the activation energy for actually writing team docs/diagrams — today's blank-template
  step is a real reason they don't get written at all.

Agent value:

- Gives an agent a real first draft to refine instead of an empty scaffold to fill from scratch.

Implementation notes:

- `src/commands/note.ts`/`src/commands/diagram.ts` currently write a fixed placeholder template
  (confirmed: no generation today). Add an opt-in `--draft` flag that feeds recent commits/the
  relevant context pack to `runAgentPrompt` and writes its output into the scaffolded file instead
  of the placeholder comment.
- Requires `llm.enabled`; without it (or without `--draft`), behavior is unchanged.

Acceptance criteria:

- Drafted content is clearly marked as AI-drafted pending human review (front-matter or comment). ✓
  (`note add --draft` writes `draft: ai-pending-review` plus an HTML review comment; `diagram add
  --draft` writes a top-of-file Mermaid comment telling reviewers to verify every node/edge/label.)
- Falls back to today's exact empty template when disabled or `--draft` isn't passed. ✓

Implemented as an opt-in `--draft` flag on both commands, feeding recent repo commits plus the top
indexed ctxhub evidence to `runAgentPrompt`. Failures and disabled LLMs do not block file creation:
they print a clear notice and write the original static scaffold instead. Focused tests cover the
disabled, success, and fallback branches for both note and diagram synthesis.

## 17. Tailored Onboarding Globs for New Repos

**Status:** Done

**Command:** extend `ctxhub repo discover` / `ctxhub repo add`

Developer value:

- Better search/index quality in a newly added repo from day one, instead of the generic default
  `knowledge.include/exclude` globs.

Agent value:

- Less manual glob-tuning before a new repo's docs/code are actually well-indexed.

Implementation notes:

- After a repo is added, optionally explore its structure (file listing, package manifests) and
  feed a summary to `runAgentPrompt`, asking for suggested `include`/`exclude` globs tailored to
  that repo's layout; present as a suggested config diff, never auto-applied.
- Requires `llm.enabled`; without it, the generic default globs apply as they do today.

Acceptance criteria:

- Suggested globs are shown as a diff to `ctxhub.yaml`, not written automatically. ✓
  (`repo add --suggest-globs` and `repo discover --suggest-globs` print a diff-like repo-entry patch
  showing suggested `include`/`exclude` keys; they never mutate config beyond adding the repo.)
- Falls back cleanly to today's default-glob behavior when disabled. ✓

Implemented as an opt-in suggestion path on `ctxhub repo add` and `ctxhub repo discover`, using
the repo's top-level entries plus representative file samples to ask `runAgentPrompt` for a small,
repo-relative `include`/`exclude` set. Invalid/failed/disabled LLM paths print a clear notice and
leave the repo on the workspace defaults. Focused tests cover disabled fallback, structured parsing,
and diff rendering.

## 18. Eval Golden-Query Expansion

**Status:** Done

**Command:** extend `ctxhub eval`

Developer value:

- Keeps the search-quality dashboard meaningful as a workspace evolves, instead of slowly going
  stale because nobody had time to add new golden queries by hand.

Agent value:

- More representative eval coverage means more predictable retrieval behavior over time.

Implementation notes:

- `src/commands/eval.ts`'s `EvalSuite` (`.ctxhub/cache/eval.json`) is manually curated today. Add
  `ctxhub eval --suggest-queries`, feeding recent search activity or repo content to
  `runAgentPrompt` for candidate golden queries + expected repo/path, appended to the suite for
  human review before being trusted.
- Requires `llm.enabled`; without it, the suite stays exactly as manually curated today.

Acceptance criteria:

- Suggested cases are appended, never silently replacing existing curated cases. ✓
- Each suggested case includes its rationale so a human can quickly accept/reject it. ✓

Implemented as `ctxhub eval --suggest-queries`, which uses the existing manifest + configured repo
set as grounded evidence, asks `runAgentPrompt` for 3-5 candidate cases, and appends only new
queries into the suite JSON. Each stored case now supports an optional `rationale` field, and the
eval markdown report renders that rationale when present. Disabled/failed/invalid LLM paths leave
the suite unchanged and print a clear notice.

## 19. Standalone `ctxhub ask`

**Status:** Done

**Command:** `ctxhub ask "<question>"`

Developer value:

- Makes ctxhub useful to a developer with no agent harness open at all, not just as an MCP backend
  for one.

Agent value:

- N/A (this is specifically for developers without an agent session running).

Implementation notes:

- Thin wrapper: `createContextPack` + `runAgentPrompt` in one command, same LLM/fallback pattern
  as `ctxhub explain` (in fact, likely built directly on `createExplainResult`).
- Requires `llm.enabled`; without it, suggest running `ctxhub explain`/`ctxhub pack` instead via
  `llmDisabledNotice`, since there's no non-LLM "ask" scaffold that makes sense standalone.

Acceptance criteria:

- `ctxhub ask "<question>"` answers grounded in ctxhub's index only, with citations. ✓
- Clear, actionable message when `llm.enabled` is false (this command has no fallback mode). ✓

Implemented as a thin wrapper around `createExplainResult`'s existing retrieval + synthesis path,
but with stricter behavior than `explain`: if LLM synthesis is disabled or unavailable, it does
not emit the non-LLM scaffold as if it were an answer. Instead it prints a clear notice pointing
the user at `ctxhub explain` or `ctxhub pack` for the raw evidence view. Focused tests cover the
disabled, success, and timeout/unavailable branches.

## 20. Natural-Language Query Rewriting in Front of `search`

**Status:** Done

**MCP/CLI:** extend `search` / `ctxhub search`

Developer value:

- Modest per-query quality bump for less experienced users who haven't learned how to phrase a
  good ctxhub query yet.

Agent value:

- Marginal — most agents already phrase reasonably well-scoped queries.

Implementation notes:

- Optional pre-pass: feed the raw query to `runAgentPrompt`, asking for a better-scoped
  query + facet (`type`) before running the real `search`; only apply if the rewrite is
  meaningfully different, and always show the original alongside the rewritten one so the caller
  isn't confused about what actually ran.
- Requires `llm.enabled`; without it, the query runs exactly as typed, as today.

Acceptance criteria:

- Response includes both the original and rewritten query when a rewrite happened. ✓
- Never silently changes results without surfacing that a rewrite occurred. ✓

Implemented as an opt-in rewrite pre-pass on both the CLI (`ctxhub search --rewrite-query`) and
the MCP `search` tool (`rewriteQuery: true`). The rewrite prompt returns strict JSON with a new
query and optional narrowed facet, but ctxhub only applies it when it meaningfully changes the
original input; otherwise the search runs unchanged. Disabled/failed/invalid rewrite attempts run
the original query and surface a clear notice instead.

## 21. LLM-Authored File Summaries at Index Time

**Status:** Done

**Indexing:** extend `buildFileSummaryChunk` (`src/indexing/chunk.ts`)

The LLM-backed half of the file-summary feature already shipped in its non-LLM form (heading/
symbol-name list). This is the richer follow-up.

Developer value:

- A genuinely readable one-paragraph summary of a large file instead of just its heading/symbol
  list.

Agent value:

- Faster orientation on large, heavily-chunked files without opening every chunk.

Implementation notes:

- At index time, when `buildFileSummaryChunk` would otherwise produce a heading-list summary,
  optionally feed the full file content to `runAgentPrompt` for a real prose summary instead —
  same cost/risk profile as every other LLM-backed feature here, so it should be gated by
  `llm.enabled` and only attempted for files above some size threshold (indexing every small file
  through an agent CLI would be slow and wasteful).
- Requires `llm.enabled`; falls back to the existing non-LLM heading/symbol-list summary.
- Indexing already runs one file at a time in `src/indexing/indexer.ts`'s loop, so this is a
  natural, already-sequential integration point — no new concurrency handling needed.

Acceptance criteria:

- Summary content is grounded in the actual file, no invented capabilities. ✓
- Falls back to the non-LLM summary when disabled, unavailable, or the call fails/times out. ✓
- Indexing a large workspace with `llm.enabled: false` (the default) is exactly as fast as today. ✓

Implemented by upgrading the existing `buildFileSummaryChunk` path with an async wrapper used only
during indexing: when a file already qualifies for a summary chunk, `llm.enabled` is on, and the
file is large enough to be worth it, ctxhub asks `runAgentPrompt` for a short prose summary grounded
in the redacted file content. Disabled/unavailable/failed calls fall straight back to the previous
heading/symbol-list summary, so the default indexing path stays unchanged.
