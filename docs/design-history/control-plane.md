# Control plane: reviewing the vision and planning the adoption path

`ctxhub-project-brief.md` and `ctxhub-AI-Control-Plane-Recommendations.md` (both ChatGPT-authored,
summarizing an earlier conversation) sketch a much larger next phase: evolving ctxhub from a
per-workspace CLI into a **local AI control plane** — a persistent background service that
manages multiple workspaces, harnesses, personas, and providers from one point of control, plus a
"Mission Control" UI on top. This document is the review of that vision and the phased adoption
plan, in the same spirit as [docs/personas.md](./personas.md) did for the Portable Agent Persona
Specification — but this is explicitly a **planning-only** pass, not an implementation one. Nothing
in this document has been built yet.

## Orchestration is now a first-class pillar, not a hedge

An earlier draft of this document raised a real tension: `deep-research-report.md` (the
competitive-analysis pass, also in this repo) had warned that ctxhub's durable niche was being
**the open context and memory fabric around whichever harness a developer already uses**, and that
adding an orchestration/automation layer risked sliding into "yet another agent product." That
caution was worth naming, but it's now resolved deliberately in the other direction: the explicit
goal is a **personal, customizable orchestration framework** for running agentic workflows across
work and personal projects — not something to hedge against, but the second core pillar of what
ctxhub is, alongside the context/memory fabric it already does well. Fleet Captains, Workspace
Captains, and Mission Control are in scope as real, wanted destinations, not speculative extras to
keep re-litigating.

This doesn't discard the boundary the brief itself drew — **ctxhub owns orchestration, personas,
policies, routing, evidence, approvals, workspace management; external systems own inference, model
hosting, provider APIs, agent execution** — and it doesn't discard the "harnesses handle execution"
principle either: Captains dispatch to configured harness CLIs the same way every other LLM-backed
feature already does, rather than adding a second inference engine. What changes is *how much
ctxhub actively decides and schedules*, not *who actually runs the model*. The phasing below still
starts with the lowest-risk, most natural extensions of what's already shipped (Workspace Registry,
a thin service, Execution Profiles on top of the already-built persona system) before the daemon/UI
and Captain layers — not because those later phases are in doubt, but because each phase is real,
usable infrastructure the next one builds on, and sequencing that way surfaces problems early.

## What's a step change vs. what's a natural extension

Today, ctxhub is **stateless and single-workspace per invocation**: `src/config/config.ts` walks
upward from `cwd` for a config file, and every command operates on exactly one discovered
workspace root for the duration of one process. The *only* existing precedent for a persistent
background process is `ctxhub watch --detach` (PID file + log file under
`.ctxhub/cache/watch.{pid,log}`, `--status`/`--stop` to manage it) — and that's still scoped to one
workspace.

The Workspace Registry, control-plane service, and Mission Control UI require a genuinely new
primitive: a long-running, multi-workspace daemon with its own user-level state and an HTTP/WS API,
plus a UI process that talks to it. That's not an incremental change to the CLI — it's a new
category of thing ctxhub does. Naming this plainly up front is why this plan phases the daemon/UI
work behind the lower-risk registry work, rather than treating them as one lump.

By contrast, **Execution Profiles and the APS engine are natural extensions** of work already
shipped: the persona system (`src/personas/persona.ts`, `src/commands/personas.ts`,
[docs/personas.md](./personas.md)) already has personas, policies, and per-harness compilation.
Execution Profiles are "bind a persona to a harness + provider + model" — additive metadata on top
of what already exists, not a new subsystem.

## Decisions this plan makes (resolving the brief's open questions where there's enough basis)

**Where does APS live? → It stays exactly where it already is.** The brief's open question assumed
APS might need to become a sub-package or separate repo. It doesn't, at least not yet: APS's own
"composition pipeline" runtime was already reviewed and deliberately *not* built in
[docs/personas.md](./personas.md#explicitly-out-of-scope-and-why) — ctxhub only adopted the
portable-data idea (personas/policies as git-tracked Markdown), which now lives as ordinary parts
of the ctxhub repo (`agents/`, `src/personas/`). There's no separate versioning pressure to solve
until (if ever) APS gets adopted by tools outside ctxhub. Revisit this only if that actually
happens — don't pre-split a package with one consumer.

**Does ctxhub shell out to agent CLIs for inference, or stay a pure route/orchestrate layer? →
Already decided, by what's shipped.** Every LLM-backed feature today (`explain`, `ask`, `review`,
`handoff`, etc.) already shells out to a configured harness CLI via `runAgentPrompt`, gated by
`config.llm.enabled`. The control-plane era doesn't need to re-litigate this. What it *does* add is
a genuinely different mode: **autonomous execution with no human-driven interactive session** —
a Fleet/Workspace Captain deciding to run a task in the background, not a person invoking
`ctxhub ask` and waiting. That's the actual new fork, and it's addressed below (Captains still
shell out to the same configured harness CLIs headlessly, in the same bounded, evidence-grounded
style already established — they are not a reason to add a parallel direct-model-API inference
path). The `InferenceGatewayAdapter`/OpenRouter/Bedrock work is a **separate, optional feature**
for users who want direct API access with no harness CLI installed at all (e.g., pure
programmatic automation, or an enterprise Bedrock-only policy) — it is not a prerequisite for
Captains to function, and shouldn't be sequenced as if it were.

**Mission Control tech stack: Electron vs. web? → Recommend a local web UI, not Electron, but this
is the one call worth confirming with the user before Phase 3 actually starts building.**
Reasoning: ctxhub already has exactly one precedent for a human-facing surface —
`ctxhub report`, a self-contained static HTML file opened in the browser, no bundler, no Electron,
no extra install. A control-plane service that's already running an HTTP/WS API (needed for the
Workspace Registry and MCP Gateway regardless of the UI question) can serve a local web UI from
the same process with no new runtime dependency, consistent with the "local-first, Node.js only,
no mandatory extra install" constraint the brief itself states. Electron would add a packaging/
distribution/auto-update surface ctxhub has never needed before, for a "feels like a real app" gain
that's real but not free. This isn't decided here because it's a genuine product-shape call with
UX tradeoffs, not something derivable from the existing codebase — flagged again in Open Questions.

**The already-flagged "architecture vNext" 50–100 page consolidation document → skip it, or at
least don't do it as a single upfront artifact.** The brief suggested consolidating all the
scattered brainstorm/spec files into one big design doc before building anything. This document is
that consolidation, done at the weight the project has actually used for every other major
feature so far (one focused review-and-plan doc per initiative, updated as it ships — see
`docs/personas.md`'s own revision history earlier in this project). A big upfront doc risks going
stale before the code catches up — `deep-research-report.md` in this same repo is already stale on
several "not shipped" items that have since shipped, which is a live example of exactly that risk.

## Phased implementation plan

### Phase 1 — Workspace Registry (shipped)

- [x] A new user-level file, `~/.ctxhub/registry.json` (mirrors the existing workspace-level
      `.ctxhub/` directory name, just promoted to user scope, via `src/workspaces/registry.ts`'s
      `getCtxhubHome()`/`getRegistryPath()` -- overridable with `CTXHUB_HOME` for tests) — a flat
      list of `{ name, path, addedAt }` entries. It's a pointer list, nothing more: each workspace
      keeps owning its own config/index/memory/personas exactly as today, matching the brief's own
      framing ("Each workspace keeps its own config, index, memory, personas, tasks and
      policies").
- [x] `ctxhub workspace register [path]` (defaults to discovering the workspace root from `cwd` via
      the existing `loadWorkspaceConfig` discovery logic, defaulting the name to the workspace's
      own `config.workspace.name`), `ctxhub workspace list`, `ctxhub workspace remove <name>` —
      plain CRUD, no daemon required.
- [x] Duplicate-path handling (`register` on an already-registered path is a no-op, returning the
      existing entry, not an error) and duplicate-name handling (a second workspace can't reuse a
      registered name without an explicit `--name`); a workspace whose directory no longer exists
      is reported (`ctxhub workspace list` marks it) but not silently pruned — matches
      `ctxhub doctor`'s existing "report, don't silently fix" bias for anything destructive.
- [x] Unit tests (`src/workspaces/registry.test.ts`, `src/commands/workspace.test.ts`):
      register/list/remove round-trip, idempotent re-registration, duplicate-name rejection,
      missing-path reporting — all pure filesystem operations, no LLM, no service process involved.
- [x] Live verification: registered two real scratch workspaces, listed them, removed one, and
      confirmed `~/.ctxhub/registry.json`'s actual on-disk contents matched at every step.

This phase alone is useful on its own (a "what workspaces do I have configured" command) and is a
prerequisite for every later phase without requiring any of them to exist.

### Phase 2 — Control-plane service (shipped, minus the WS event stream)

- [x] `ctxhub service start` / `stop` / `status` (`src/commands/service.ts`), reusing
      `ctxhub watch --detach`'s exact established pattern (detached child process, PID + log file
      under `~/.ctxhub/` instead of per-workspace `.ctxhub/cache/`, `process.kill(pid, 0)`/
      `SIGTERM`) rather than registering an OS-level launchd/systemd/Windows service. The brief
      proposed OS-level service registration from the start; this defers that specifically because
      it's a bigger, more failure-prone commitment (platform-specific service files,
      install/uninstall hygiene, permissions) than the pattern ctxhub has already proven once.
      `ctxhub service start` detaches by default (`--foreground` runs it blocking, for debugging).
      Revisit `ctxhub service install` (real OS service registration) only once the plain
      detached mode has been used for a while.
- [x] A minimal HTTP API on `127.0.0.1:7342` by default (`src/service/server.ts`, plain Node
      `http`, no new dependency): `GET /health`, `GET /workspaces` (from Phase 1's registry, with
      each entry's `exists` flag), `GET /workspaces/:name/status` (reuses `doctorChecks.ts`'s exact
      `buildDoctorChecks`/`runDoctorChecks` functions rather than inventing separate health logic,
      so the control plane's idea of a workspace's health can never drift from `ctxhub doctor`'s).
- [x] **The WebSocket event stream was deliberately descoped from this pass, not silently
      dropped.** There is nothing yet in the system that produces an event worth pushing (no
      Captains, no task coordination, no persona/policy engine wired to the service) -- building an
      event bus with nothing to publish would be exactly the kind of speculative infrastructure
      this project's own discipline argues against. Polling the HTTP API above is sufficient for
      Phase 3's Fleet-view UI. Revisit WebSockets (which would need a real dependency, since
      hand-rolling the WS wire protocol isn't worth it) once Phase 6 (Captains) actually has
      real events to emit.
- [x] **Revisited once Phase 6 landed, as flagged above -- shipped as Server-Sent Events, not a
      WebSocket.** `src/events/eventBus.ts` is a plain typed pub/sub with no new dependency, fed by
      real producers (index jobs, Captain runs/handoffs, skill installs, persona syncs) and exposed
      at `GET /events` via Node's built-in chunked-response streaming. SSE was chosen over a real
      WebSocket because the traffic is one-directional (service to browser) -- a WS dependency
      would have bought nothing a plain streamed response doesn't already give here.
- [x] No orchestration, no task coordination, no persona/policy logic in this phase — purely
      "is the registry queryable over a local API," as intended.
- [x] Unit tests (`src/service/server.test.ts`, `src/commands/service.test.ts`): every HTTP route
      against a real listening server (Node's built-in `fetch`, not a mocked request), plus the
      exact same real-spawned-process PID lifecycle proof `watch.test.ts` uses for `--stop`/
      `--status` (spawn a real dummy process, verify detection, signal it, verify cleanup).
- [x] Live verification: registered a real scratch workspace, started the service as a real
      detached background process, curled `/health`, `/workspaces`, and
      `/workspaces/<name>/status` against it, then stopped it and confirmed `service status`
      reported it gone.

### Phase 3 — Mission Control UI (shipped: Fleet view first, later grown into the full section list)

- [x] A local web UI (`src/service/fleetView.ts`, served at `GET /` by the Phase 2 service) showing
      only the Fleet overview: registered workspaces and their `ctxhub doctor`-derived health — the
      brief's other proposed sections (workspace canvas, captain chat, tasks, activity feed,
      reviews, knowledge graph, approvals queue) all depend on later phases (Captains, Execution
      Profiles, MCP Gateway) that don't exist yet and shouldn't be speculatively stubbed into a UI
      before their backing logic is real.
- [x] Reuses `ctxhub report`'s existing self-contained-HTML conventions (system-ui sans-serif,
      light/dark via `prefers-color-scheme`, inline `<style>`/`<script>`, no CDN, no bundler) rather
      than introducing a new frontend build pipeline for a one-page Fleet view. The real mechanism
      differs from `report`'s, deliberately: this page's inline JS calls the Phase 2 HTTP API
      client-side (`fetch('/workspaces')`, then per-workspace `fetch('/workspaces/:name/status')`)
      against the live running service, rather than embedding a snapshot at generation time --
      the Fleet view is meant to reflect the control plane's current state on every reload, not a
      point-in-time report.
- [x] Unit test (`src/service/server.test.ts`): `GET /` returns real HTML with the expected
      `text/html` content type, contains the `/workspaces` fetch call, and contains no CDN
      reference.
- [x] Live verification: started the real service, registered a workspace, confirmed
      `GET /workspaces` returns the exact data the page's `loadFleet()` fetches and renders.
- [x] **Fast follow, once Captains/Execution Profiles/the event bus existed to back it: the brief's
      full section list was built after all, as a real React/Vite app (`ui/`, built to `ui/dist`
      and served by the same `GET /` route, falling back to the plain `fleetView.ts` HTML when
      `ui/dist` hasn't been built).** Seven screens share one `GET /events` SSE connection and a
      Zustand store: **Fleet** (the graph above, now animated with live index/Captain-run bots
      driven by real `eventBus` events), **Captains** (task list, run history, handoff chains,
      promote a run straight into a git-tracked note without leaving the browser, a
      live "new task" form), **Knowledge** (an Obsidian-style force-directed graph of the real
      index — file and diagram-component nodes, similarity and diagram edges — with search/filter/
      highlight and a real file-content preview panel, not a synthetic summary), **Review** (run
      `ctxhub review --as <persona>` against a real base-branch diff, reusing `createReviewResult`
      -- the same function the CLI calls -- rather than a second implementation), **Config** (repos,
      execution profiles, knowledge/privacy settings, editable live), **Skills & Personas** (install/
      scaffold/sync without leaving the browser, reusing the exact CLI command logic), and **Chat**
      (ask a selected workspace a question, backed by the same `explain` machinery, not a second
      inference path). `ctxhub dashboard` (`src/commands/dashboard.ts`) starts the service if
      needed — polling `/health` rather than a fixed sleep — and opens the browser to it.
- [x] **Real, committed e2e test coverage** (`ui/e2e/`, Playwright Test): global setup registers
      and indexes a disposable *copy* of `examples/reference-workspace` (never the git-tracked
      original) under an isolated `CTXHUB_HOME` and a dedicated port (7343, separate from the real
      service's 7342), so every mutation the UI tests exercise -- config edits, skill installs,
      Captain task creation/promotion -- is fully disposable and never touches real state. Run with
      `npm run test:e2e` (root) or `npm run test:e2e` (`ui/`, once root's `dist/` is built). Caught
      a real bug while being written: `PromoteForm`'s success handler called `onDone()` in the same
      tick as `setResult()`, collapsing the form before its own success message (the note's path)
      ever painted -- a real user clicking Promote would see the form vanish with no confirmation.
      Fixed by not auto-collapsing on success.
- [x] Live verification: captured real screenshots and a full walkthrough video/GIF
      (`docs/images/`, `docs/videos/`) of every screen against the real running service — real
      registered workspaces, a real live index run, a real Captain handoff between two workspace
      nodes, real Knowledge-graph search/filter/preview against real indexed file content, and a
      real chat exchange with a fully rendered answer (not a mocked or cut-off response). Fed back
      one real bug found in the process: `ChatPanel`'s citation-chip component destructured a prop
      literally named `ref`, which React treats as a reserved special prop even on plain function
      components — passing a string through it threw a "string ref" invariant and crashed the whole
      chat panel's render tree on any answer with citations, with no error boundary to catch it.
      Fixed by renaming the prop to `refLabel`.
- [x] **Second fast follow, after live-using the recorded demo surfaced more rough edges:** Chat
      answers now render through a small hand-rolled markdown renderer (paragraphs, bullet/numbered
      lists, `**bold**`, `` `code` ``, `[E1]`-style citation markers) instead of one flat text node
      — no new dependency, since the answer format is bounded and doesn't need full CommonMark.
      Each citation now deep-links into Knowledge: clicking one switches workspace if needed,
      selects the matching node (`repo:path` against the same graph data Knowledge itself renders),
      and opens its real content preview — but only for citations that actually resolve to a graph
      node; one that doesn't (e.g. evidence from outside the current graph) still renders for
      transparency, just without looking clickable. Separately, the Knowledge graph's node display
      cap was found to be the wrong fix for its own cost problem: `MAX_FILE_NODES` (120) was
      limiting which files rendered as nodes at all, when the actual expensive part is computing
      similarity edges (one real index search per file). Fixed Obsidian-style: every indexed file
      is now a node with no display cap; only the similarity-edge computation stays budgeted
      (renamed `MAX_SIMILARITY_NODES`, still 120, still the most-recently-indexed files first).
      Nodes past that budget render with no similarity edges until clicked — clicking any file node
      fires `expandKnowledgeGraphNode` (one on-demand search) and splices whatever comes back into
      the live simulation, so the graph is genuinely navigable outward from any starting point.

### Phase 4 — Execution Profiles (shipped, wired into `explain` as the reference integration)

- [x] `CtxhubConfig.executionProfiles: Record<string, ExecutionProfile>` (`src/config/types.ts`),
      each entry `{ persona?, runtime: LlmAgentName, model?, tags? }`, defaulting to `{}` so
      nothing changes for a workspace that doesn't configure any — additive config, not a new
      engine. `src/execution/executionProfile.ts`'s `resolveExecutionProfile(config, name)` is a
      deliberately thin lookup; the real behavior lives in how callers combine it with
      `runAgentPrompt`'s existing mechanism.
- [x] `runAgentPrompt` (`src/llm/runAgent.ts`) gained `opts.agent`/`opts.model` per-call overrides,
      taking priority over `config.llm.agent`/auto-detection -- an Execution Profile's `runtime` is
      never silently swapped for another CLI, same discipline as the existing configured-agent
      path. `model` is passed through as `--model` for claude and `-m` for codex (both verified
      against their real `--help` output); copilot/cursor accept the override but don't act on it
      yet, since their invocations are already best-effort/unverified and guessing a second
      unverified flag on top of a first isn't worth it.
- [x] `--profile <name>` wired into `ctxhub explain` as the reference integration (other
      persona-driven commands -- `ask`/`handoff`/`review` -- can adopt the identical pattern as a
      fast follow; not done in this pass to keep this commit reviewable). Resolution order:
      `--as <persona>` always wins for framing when both are given; the profile's own `persona`
      field is the default when `--as` is omitted; an unknown `--profile` name throws immediately,
      before any evidence gathering.
- [x] No gateway adapters required for this phase — an execution profile whose `runtime` is an
      already-configured harness CLI (`claude`, `codex`, `copilot`, `cursor`) works with zero new
      infrastructure, using the exact `runAgentPrompt` mechanism that already exists.
- [x] Unit tests: `src/execution/executionProfile.test.ts` (resolver), `src/llm/runAgent.test.ts`
      (agent/model override priority and argument passthrough), `src/commands/explain.test.ts`
      (unknown-profile rejection, persona-default-from-profile, `--as`-wins-for-framing).
- [x] Live verification: configured a real `fast-claude` execution profile
      (`runtime: claude, model: claude-haiku-4-5`) and ran `ctxhub explain ... --profile
      fast-claude` against the real `claude` CLI -- got a real synthesized, cited answer, proving
      the model override reaches an actual invocation, not just a mocked one.

### Phase 5 — Central MCP Gateway (shipped, with one deliberate deviation from the original sketch)

- [x] `ctxhub mcp --central` (`src/mcp/centralServer.ts`) is a stdio MCP server exposing two
      tools: `list_workspaces` (reads Phase 1's registry directly) and `call_workspace_tool`
      (`{ workspace, tool, arguments }`), which routes into the named workspace's own,
      already-existing `createCtxhubMcpServer` instance (`src/mcp/server.ts`) -- lazily created
      and cached per workspace name, connected in-process via the MCP SDK's own
      `InMemoryTransport.createLinkedPair()` rather than re-declaring every tool's schema on the
      gateway itself. Explicitly **never** merges multiple workspaces' indexes into one global
      search space — a caller always names exactly which registered workspace a tool call targets,
      matching ctxhub's existing "read-only index" discipline.
- [x] **Deviation from the original sketch, and why:** the plan above described the gateway as "a
      stdio proxy that connects to the Phase 2 service." What's actually built instead reads the
      Phase 1 registry directly and spawns each workspace's `McpServer` in-process within the
      `ctxhub mcp --central` process itself -- it does not require `ctxhub service start` to be
      running at all. This is simpler (no HTTP round-trip, no dependency on the service process's
      lifecycle) and there was no concrete reason found, while building this, that the gateway
      needs the service running -- both read the exact same `~/.ctxhub/registry.json`. Revisit
      only if a real need emerges for the gateway and the service to share more state than that
      (e.g. Captains dispatching through the gateway from Phase 6).
- [x] Unit tests (`src/mcp/centralServer.test.ts`): empty registry, unregistered-workspace error
      (surfaced as `isError: true`, not a crash), a real routed `search` call against a real
      indexed workspace, and per-workspace client reuse across repeated calls.
- [x] Live verification: ran the real `ctxhub mcp --central` process over actual stdio (via the
      MCP SDK's `StdioClientTransport`, not the in-process test harness), registered a real
      workspace, and confirmed `list_workspaces` and `call_workspace_tool` → `search` returned the
      workspace's real indexed content, while an unregistered workspace name cleanly errored.

### Phase 6 — Fleet Captain / Workspace Captain (shipped: manual trigger, scheduled trigger deferred)

- [x] A Captain task is plain, editable config (`~/.ctxhub/captains.json` via
      `src/captains/tasks.ts` -- `ctxhub captain add/list/remove`): `{ name, workspace, query,
      persona?, profile? }`. Deliberately *not* a bare free-floating prompt: running a task means
      calling the exact same evidence-grounded `createExplainResult` machinery every other
      persona-driven command already uses, headlessly, against the named registered workspace --
      "a Captain" is "run `ctxhub explain` unattended, on a trigger, against a workspace," not a
      new inference path. `persona`/`profile` reuse Phases 4's Execution Profile resolution
      exactly as `explain --as`/`--profile` already do.
- [x] `ctxhub captain run <name>` (`src/captains/runner.ts`) is the trigger for this phase --
      manual, on demand. **Scheduled/triggered-by-the-service execution is now also shipped**, as
      a fast follow: `CaptainTask` gained an optional `schedule: { everyMinutes }` field
      (`ctxhub captain add ... --schedule-every-minutes <n>`); the running `ctxhub service`
      (`src/commands/service.ts`'s `runForegroundService`) polls task definitions every 60s
      (`src/captains/scheduler.ts`'s `runDueCaptainTasks`/`isCaptainTaskDue`, due-ness computed
      from each task's own most recent pending-run timestamp -- no separate "last run" state file
      needed) and runs any that are due, calling the exact same `runCaptainTask` function
      `ctxhub captain run` uses manually. A tick is skipped entirely while a previous poll is still
      in flight, so a slow task can never be triggered twice concurrently by an over-fast poll.
      Absent `schedule`, a task stays manual-only, unchanged from before.
- [x] Approval gating (the brief's "Approvals queue") is real, not optional: `runCaptainTask`
      *never* writes to a repo. It only ever writes its full result to a user-level, non-git-tracked
      pending-runs queue (`~/.ctxhub/captains/<task>/<runId>.json`, `ctxhub captain approvals
      <task>` lists them). The one deliberate, human-invoked action that turns a pending run into
      a real, team-visible artifact is `ctxhub captain promote <task> <runId> <repo>` -- which
      reuses `note.ts`'s existing `draftedNoteTemplate` unmodified (the exact same "AI draft,
      review before merge" shape `note add --draft` already produces) rather than inventing a
      second promoted-content format. This mirrors the same human-in-the-loop discipline every
      other invasive/write-capable ctxhub feature already requires (`--fix-skills`,
      `--fix-personas`, `--allow-index`, `--allow-memory-write`).
- [x] "Customizable" shows up concretely here: task definitions (which workspace, what question,
      which persona/profile) are a plain JSON file a user edits directly -- the same "config, not
      hardcoded dispatch logic" pattern personas/policies/execution profiles already established.
- [x] Unit tests: `src/captains/tasks.test.ts` (CRUD, duplicate-name rejection),
      `src/captains/runner.test.ts` (unregistered-workspace rejection, real run against a real
      indexed workspace, run listing, promotion into the correct workspace's repo, unknown-run/
      unknown-repo rejection), `src/commands/captain.test.ts` (full CLI flow: add → list → run →
      approvals → promote → remove).
- [x] Live verification against the real `claude` CLI: defined a task, ran it (got a real,
      evidence-cited answer about a fictional payments flow), listed it via `captain approvals`,
      promoted it, and confirmed the resulting note file's frontmatter/body matched
      `draftedNoteTemplate` exactly, while the original pending JSON record remained in the
      non-git-tracked queue untouched.
- [x] Scheduled-trigger unit tests (`src/captains/scheduler.test.ts`, `src/commands/service.test.ts`):
      due-ness math against the most recent run (not the oldest), unscheduled tasks always skipped,
      a real registered/indexed workspace's scheduled task actually running via a real
      `runForegroundService` instance. Live-verified end to end against the real detached
      background service: started it with a `--schedule-every-minutes 1` task, waited past the
      poll interval, and confirmed a real pending run appeared via `captain approvals`, then
      confirmed the service log recorded the scheduled run.
- [x] **A real concurrency bug was caught and fixed while building this, not shipped
      silently.** The first version tracked only the most-recently-fired poll's promise for
      `stop()` to await; under a fast poll interval (as in the test, not the real 60s default) a
      new tick could fire before the previous `runDueCaptainTasks()` call finished, both would see
      the same "not yet run" state and both would start writing to the same task's pending-runs
      directory concurrently -- losing track of the earlier, still-in-flight write and (in tests)
      racing directory cleanup against an active write (`ENOTEMPTY` on `rmdir`). Fixed by skipping
      a tick entirely whenever a previous poll is still in flight, rather than letting polls
      overlap -- confirmed by running the full suite 5 times in a row clean after the fix, having
      seen it fail intermittently before.

### Phase 7 — Gateway adapters (shipped: the generic OpenAI-compatible adapter)

- [x] Fully decoupled from Phases 1–6; only relevant to users who want direct model-provider
      access without any harness CLI installed. Built the brief's own top-priority adapter first:
      **one generic OpenAI-compatible adapter** (`src/gateway/openaiCompatible.ts`, Node's built-in
      `fetch`, no new dependency) covers OpenRouter, LiteLLM, Portkey, Ollama, and enterprise
      proxies through a single `baseUrl` -- exactly the brief's own reasoning for prioritizing it
      first. AWS Bedrock and Anthropic-direct adapters are **not built** in this pass -- each needs
      its own request/auth shape (SigV4 for Bedrock, a different message format for Anthropic's
      native Messages API), a real scoping decision deferred until there's an actual need (the VF3
      Bedrock case explicitly still needs real input, per the Open Questions below), not something
      to guess at speculatively. LiteLLM/Portkey/Cloudflare AI Gateway/vLLM Semantic Router stay
      optional/later per the brief's own prioritization — nothing here changes that assessment
      (LiteLLM/Portkey/Ollama are in practice already covered by the generic adapter above, since
      all three speak the OpenAI-compatible protocol).
- [x] `ExecutionProfile.runtime` gained a `'direct-api'` option alongside the four harness names,
      plus an optional `gateway: { baseUrl, apiKeyEnv? }` field (`src/config/types.ts`) -- the API
      key itself is never stored in config, only the name of an environment variable holding it,
      so a workspace's `ctxhub.yaml` (which may be git-tracked) never carries a secret.
      `runAgentPromptFnForProfile` (`src/execution/executionProfile.ts`) picks, once up front,
      between the real `runAgentPrompt` (harness CLIs) and a gateway-calling wrapper -- callers
      (`ctxhub explain --profile`, Captains) don't need to branch per call.
- [x] Unit tests: `src/gateway/openaiCompatible.test.ts` (request shape, trailing-slash handling,
      Authorization header from a named env var, HTTP-error/empty-content/timeout error mapping),
      `src/execution/executionProfile.test.ts` (profile-to-function selection,
      `config.llm.enabled` still respected, missing-gateway/missing-model error messages).
- [x] Live verification, genuinely external this time (not just against a harness CLI): started a
      real local Ollama server, pulled a small real model (`qwen2.5:0.5b`), configured a
      `direct-api` execution profile pointing at Ollama's own OpenAI-compatible endpoint
      (`http://localhost:11434/v1`), and ran `ctxhub explain --profile local-ollama` against a real
      indexed workspace -- got back a real, evidence-cited synthesized answer with **no harness
      CLI involved at all**, proving the direct-API path genuinely works end to end.

## Explicitly out of scope for now

- **OS-level service registration** (`ctxhub service install` registering launchd/systemd) —
  deferred until the plain detached-process mode (Phase 2) has proven itself, per the reasoning
  above.
- **vLLM Semantic Router integration** — the brief itself already calls this "too heavy for MVP";
  nothing in this plan changes that. If pursued later, borrow the *concept* (pluggable
  `TaskClassifier`) rather than the container-heavy implementation.
- **Merging workspace indexes** — never in scope, at any phase; this is a hard architectural
  boundary, not a sequencing choice.
- **AWS Bedrock and Anthropic-direct gateway adapters** — each needs its own request/auth shape
  (SigV4 signing for Bedrock, a different message format for Anthropic's native Messages API), not
  something to build speculatively ahead of a concrete need. The generic OpenAI-compatible adapter
  already covers most of Phase 7's practical value (OpenRouter, LiteLLM, Portkey, Ollama,
  enterprise proxies); Bedrock specifically waits on real input about VF3's actual AWS setup (see
  Open Questions).
- **A guided `ctxhub provider add openrouter` onboarding wizard** — the brief sketched this as a
  paste-a-key-and-go flow. The underlying capability (a `direct-api` execution profile with
  `gateway.baseUrl`/`gateway.apiKeyEnv`) works today via plain config; the wizard itself is a thin
  UX layer on top that wasn't built in this pass.

## Open questions still requiring a decision from the user, not derivable from the codebase

1. **Mission Control tech stack** — this plan recommends a local web UI over Electron (see above),
   but it's a real product-shape call worth confirming before Phase 3 build work starts, not
   something to silently lock in.
2. **VF3 / enterprise client model** — workspace policies, IAM integration, private-connectivity
   requirements for the Bedrock adapter (Phase 7). This needs actual input about VF3's real AWS
   setup and isn't something to design from first principles; the `executionPolicy`
   (`requireTags`/`denyGateways`/`allowRegions`/`requirePrivateConnectivity`) sketch in the brief
   is a reasonable starting shape once that input exists.
