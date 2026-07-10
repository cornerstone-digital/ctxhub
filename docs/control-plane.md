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

### Phase 2 — Control-plane service (the daemon, kept as small as possible)

- [ ] `ctxhub service start` / `stop` / `status`, reusing `ctxhub watch --detach`'s exact
      established pattern (detached child process, PID + log file, `process.kill(pid, 0)`/
      `SIGTERM`) rather than registering an OS-level launchd/systemd/Windows service. The brief
      proposed OS-level service registration from the start; this plan defers that specifically
      because it's a bigger, more failure-prone commitment (platform-specific service files,
      install/uninstall hygiene, permissions) than the pattern ctxhub has already proven once.
      Revisit `ctxhub service install` (real OS service registration) only once the plain
      detached mode has been used for a while.
- [ ] A minimal HTTP/WS API on `127.0.0.1:7342` (the brief's own suggested port) exposing: list
      registered workspaces (from Phase 1's registry), per-workspace status (reusing
      `doctorChecks.ts`'s existing check functions instead of inventing new health logic), and a
      WebSocket event stream for future consumers (Mission Control, later phases) to subscribe to
      without polling.
- [ ] No orchestration, no task coordination, no persona/policy logic in this phase — purely
      "is the registry queryable over a local API." Keeping this phase this narrow is deliberate:
      it's the one phase most likely to reveal whether the daemon model is worth the complexity
      before committing to UI/Captain work on top of it.

### Phase 3 — Mission Control UI (Fleet view only, not the full section list from the brief)

- [ ] A local web UI (see the tech-stack decision above) served by the Phase 2 service, showing
      only the Fleet overview (list of registered workspaces, their `doctor`-derived health,
      last-indexed time) — the brief's other proposed sections (workspace canvas, captain chat,
      tasks, activity feed, reviews, knowledge graph, approvals queue) all depend on later
      phases (Captains, Execution Profiles, MCP Gateway) that don't exist yet and shouldn't be
      speculatively stubbed into a UI before their backing logic is real.
- [ ] Reuses `ctxhub report`'s existing static-HTML-generation approach as its starting point
      where practical (same team already knows this pattern), rather than introducing a new
      frontend build pipeline for a one-page Fleet view.

### Phase 4 — Execution Profiles (extends the already-shipped persona system, doesn't replace it)

- [ ] YAML-defined profiles binding a persona (already real, from `agents/personas/*.md`) to a
      harness + provider + model + tags, per the brief's sketch (`executionProfiles` in
      workspace config). This is additive config, not a new engine: `--as <persona>` on
      `explain`/`ask`/`handoff`/`review` already resolves a persona; an execution profile is one
      more optional layer that says *which* harness/model a given persona should run under when
      more than one is configured.
- [ ] No gateway adapters required for this phase — an execution profile whose `runtime` is an
      already-configured harness CLI (`claude`, `codex`, `copilot`, `cursor`) works with zero new
      infrastructure, using the exact `runAgentPrompt` mechanism that already exists.

### Phase 5 — Central MCP Gateway

- [ ] `ctxhub mcp --central` (a stdio proxy that connects to the Phase 2 service) routes MCP tool
      calls into the correct workspace's already-existing per-workspace MCP server logic
      (`src/mcp/server.ts`), selected by an explicit workspace parameter or by which workspace an
      agent is currently rooted in. Explicitly **never** merges multiple workspaces' indexes into
      one global search space — this was already a hard constraint in the brief and matches
      ctxhub's existing "read-only index" discipline.

### Phase 6 — Fleet Captain / Workspace Captain (the orchestration pillar's core deliverable)

- [ ] Sequenced last because it depends on every earlier phase (registry, service, Execution
      Profiles, MCP Gateway) actually existing, not because it's in doubt — this is the piece that
      makes ctxhub a genuine personal orchestration framework rather than a set of building blocks
      for one. A Captain is a scheduled/triggered task dispatcher that picks a workspace + persona +
      execution profile and calls `runAgentPrompt` headlessly (same mechanism as every other
      LLM-backed feature today, just triggered by the service instead of a person typing a command)
      — not a new autonomous-execution runtime; it still delegates to whichever harness CLI is
      configured.
- [ ] Approval gating (the brief's "Approvals queue") is not optional for this phase: anything a
      Captain does unattended needs a human-in-the-loop checkpoint before it writes anything,
      consistent with how invasive fixes already require opt-in flags elsewhere in ctxhub
      (`--fix-skills`, `--fix-personas`, `--allow-index`, `--allow-memory-write`).
- [ ] This is also where "customizable" should show up concretely: Captain routing rules, which
      persona/execution-profile combination handles which kind of trigger, and approval thresholds
      should be plain, editable config (mirroring how personas/policies/execution profiles are all
      already just files a user edits), not hardcoded dispatch logic.

### Phase 7 — Gateway adapters (OpenRouter, Bedrock, generic OpenAI-compatible, etc.)

- [ ] Fully decoupled from Phases 1–6; only relevant to users who want direct model-provider
      access without any harness CLI installed. Priority order per the brief: generic
      OpenAI-compatible (covers LiteLLM/Portkey/Ollama/enterprise proxies via one `baseUrl`),
      OpenRouter (OSS onboarding), AWS Bedrock (enterprise/VF3), Anthropic direct. LiteLLM,
      Portkey, Cloudflare AI Gateway, vLLM Semantic Router stay optional/later per the brief's own
      prioritization — nothing here changes that assessment.

## Explicitly out of scope for now

- **OS-level service registration** (`ctxhub service install` registering launchd/systemd) —
  deferred until the plain detached-process mode (Phase 2) has proven itself, per the reasoning
  above.
- **vLLM Semantic Router integration** — the brief itself already calls this "too heavy for MVP";
  nothing in this plan changes that. If pursued later, borrow the *concept* (pluggable
  `TaskClassifier`) rather than the container-heavy implementation.
- **Merging workspace indexes** — never in scope, at any phase; this is a hard architectural
  boundary, not a sequencing choice.
- **Full Mission Control section list** (workspace canvas, captain chat, activity feed, reviews,
  knowledge graph, approvals queue) — each of these belongs to whichever phase supplies its real
  backing data (Captains, Execution Profiles, MCP Gateway); building UI chrome ahead of that data
  existing was explicitly avoided in Phase 3's scoping above.

## Open questions still requiring a decision from the user, not derivable from the codebase

1. **Mission Control tech stack** — this plan recommends a local web UI over Electron (see above),
   but it's a real product-shape call worth confirming before Phase 3 build work starts, not
   something to silently lock in.
2. **VF3 / enterprise client model** — workspace policies, IAM integration, private-connectivity
   requirements for the Bedrock adapter (Phase 7). This needs actual input about VF3's real AWS
   setup and isn't something to design from first principles; the `executionPolicy`
   (`requireTags`/`denyGateways`/`allowRegions`/`requirePrivateConnectivity`) sketch in the brief
   is a reasonable starting shape once that input exists.
