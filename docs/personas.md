# Persona system: reviewing APS and adopting it into ctxhub

This is the implementation plan for folding the **Portable Agent Persona Specification (APS)**
concept — proposed in `Portable-Agent-Persona-Specification.md` and its v2 draft, both
ChatGPT-authored — into ctxhub. It covers what's worth adopting, what isn't (yet), and exactly how
it works in practice across the harnesses ctxhub already supports (Claude Code, Codex, Copilot,
Cursor).

This plan is scoped to **the persona/policy system only**. The broader "AI control plane" vision
in `ctxhub-project-brief.md` and `ctxhub-AI-Control-Plane-Recommendations.md` (Mission Control UI,
Fleet/Workspace Captains, Execution Profiles, gateway routing) is real context for where this could
eventually connect, but is explicitly **not** designed here — see "Explicitly out of scope" below
for why.

Status legend for the checkboxes below: check a box when the work is done, tested, and verified
live — not when code is merely written.

## The review

APS's core insight is sound and, more importantly, **already half-true in this codebase**: this
session built `ctxhub review --as <persona>` (NEXT_FEATURES #27/#28), where a `ReviewerProfile`
(`name`, `kind`, `focus`) is data loaded from `.ctxhub/cache/review-profiles.json`, not a hardcoded
prompt. APS's proposal is essentially "generalize that pattern beyond `review` into a first-class,
cross-command persona concept" — which is a legitimate, incremental next step, not a new idea from
scratch.

Three things in the spec are genuinely worth adopting:

1. **Personas as portable Markdown, loaded from a manifest** — directly extends the
   `ReviewerProfile`/`loadReviewerProfiles` pattern that already exists and already works.
2. **A formal policy layer that always wins over persona preference** — this isn't hypothetical.
   Grepping the codebase turns up **six separate, near-identical restatements** of the same "cite
   only this evidence, never invent" instruction, hand-duplicated across `explain.ts`, `handoff.ts`,
   `note.ts`, `review.ts`, `eval.ts`, and `diagram.ts`. APS's "policy" concept is exactly the fix:
   one shared, git-tracked source of truth instead of six copies that will inevitably drift.
3. **A harness capability table driving per-harness compilation** — this is `src/llm/harness.ts`'s
   `AGENT_CAPABILITIES` (built this session, NEXT_FEATURES #29), and APS's v2 draft explicitly
   proposes extending it with `nativeSubagents`/`nativePersonas`/`projectInstructions`. Directly
   buildable on top of existing, tested infrastructure.

Two things in the spec overreach for what ctxhub is today, and I'm not building them as part of
this plan:

1. **The runtime "Composition Pipeline"** (Persona Resolver → Capability Resolver → Context
   Composer → Harness Adapter, assembling context live during an agent's turn) describes ctxhub
   sitting *inside* the execution loop of every agent interaction. That contradicts the standing
   principle in `docs/philosophy.md` that "harnesses handle execution" — ctxhub shells out to a
   configured agent CLI for its own bounded, one-shot LLM-backed features, but it does not
   intercept or rewrite what Claude Code/Codex/Cursor do on their own turns. What we can actually
   build is **static compilation** (write persona-aware files ahead of time, the same mechanism
   `ctxhub skills install` already uses) plus **per-call prompt composition** for ctxhub's own
   `runAgentPrompt()`-backed features, where ctxhub is already the one constructing the prompt.
   That's Phase 2/3 below — real, and much smaller than a live orchestration engine.
2. **Native sub-agent delegation orchestration** (ctxhub actually coordinating multiple personas
   cooperating on one task) is `SUBAGENTS_BRAINSTORM.md`'s own B-track, flagged there as "a real
   architectural step up" with real cost/risk. Nothing here builds that. Where a harness has real
   native delegation (Claude Code's Task tool), the plan is to make personas *available* to it as
   native subagent files, not to drive delegation ourselves.

Everything else in APS v2 (Execution Profiles, gateways, OpenRouter/Bedrock adapters) belongs to
the separate control-plane document, not this one.

## Decision log

| APS concept | Adopt? | Maps to |
| --- | --- | --- |
| Persona (Markdown identity/decision-framework doc) | **Adopt** | New `agents/personas/*.md`, generalized from `ReviewerProfile` |
| Policy (mandatory, persona-can't-override instructions) | **Adopt** | New `agents/policies/*.md`; consolidates 6 duplicated "never invent" strings |
| Manifest (`agents/manifest.yaml`) | **Adopt** | Same YAML style as `ctxhub.yaml`, seeded on first use like `review-profiles.json` |
| Harness capability model extension | **Adopt** | Extend the real `AGENT_CAPABILITIES` table in `src/llm/harness.ts` |
| Adapter model (compile persona → harness-native file) | **Adopt** | New `ctxhub personas sync`, same mechanism as `ctxhub skills install` |
| Skill / Command / Room as distinct primitives | **Partially adopt** | Skills already exist (`ctxhub skills install`); Commands = ctxhub's own CLI commands with `--as`; Rooms deferred (see below) |
| Composition Pipeline (live runtime context assembly) | **Defer** | Would require ctxhub inside the execution loop — contradicts "harnesses handle execution" |
| Native sub-agent delegation orchestration | **Defer** | `SUBAGENTS_BRAINSTORM.md` B-track; separate, bigger decision |
| `persona.schema.json` formal validation | **Defer (stretch)** | Nice-to-have once the Markdown format stabilizes; not needed to ship |
| Execution Profiles / gateway routing | **Out of scope for this doc** | Belongs to `ctxhub-AI-Control-Plane-Recommendations.md` |

## A concrete gotcha the spec's own layout doesn't survive

APS v2 proposes `.ctxhub/agents/...` as the location. That doesn't work as-is: `.gitignore` in this
repo (and in every ctxhub-managed workspace) excludes the entire `.ctxhub/` directory, because it's
where the index, cache, and local memory files live — none of which should be committed. Personas
and policies are meant to be reviewed, PR'd, git-tracked team assets (the same category as
`docs/architecture/*.mmd` or `<repo>/agent-notes/*.md`), so they cannot live under `.ctxhub/` without
either quietly vanishing from git history or requiring a `.gitignore` carve-out that fights the
directory's whole purpose.

**Resolution:** a new top-level `agents/` directory at the workspace root, alongside `docs/` and
`ctxhub.yaml` — not nested under `.ctxhub/`. This has the same tracking expectations `ctxhub.yaml`
itself already has: if the workspace root is its own git repo (common for solo/small-team setups or
a dedicated "meta" repo), it's naturally tracked; if the workspace root has no `.git` of its own,
that's the same pre-existing situation `ctxhub.yaml` is already in today, not a new problem this
plan needs to solve.

```text
agents/
  manifest.yaml
  personas/
    architect.md
    reviewer.md
    implementer.md
  policies/
    evidence.md
```

## Phased implementation plan

### Phase 1 — Persona and policy files (data only, no behavior change)

- [x] `src/personas/persona.ts`: `Persona`/`PersonaManifest` types
- [x] `loadPersonaManifest()`, `loadPersona()`, `loadPolicyText()`
- [x] Seed `agents/manifest.yaml` + starter `personas/architect.md` + `policies/evidence.md` (via `ctxhub personas init`, not auto-seeded on read -- see deviation noted below)
- [x] `loadPolicyText()`/`loadPersona()` return empty/undefined (not today's inline wording, which stays put unchanged) when no `agents/` directory exists
- [x] `ctxhub personas init` command (kept separate from `ctxhub onboard` for now)
- [x] Wire an optional, additive policy block (from `loadPolicyText()`) into all 6 prompt builders (`explain`, `handoff`, `note`, `review`, `eval`, `diagram`) plus `ask` (which delegates to `explain`) — empty by default, never replacing each command's own existing evidence-format wording
- [x] Unit tests: seed-vs-read-existing-file behavior (persona.test.ts), byte-identical-when-absent behavior (per-command tests), preamble assembly (`buildPromptPreamble`)
- [x] Full suite/build/lint clean (405 tests passing); verified live that a fresh workspace's `explain` output is unchanged before `ctxhub personas init` is ever run

**New module:** `src/personas/persona.ts`

```ts
export type Persona = { name: string; description?: string; body: string };
export type PersonaManifest = { version: 1; personas: Record<string, { source: string }>; policies: string[] };

export async function loadPersonaManifest(workspaceRoot: string): Promise<PersonaManifest>;
export async function loadPersona(workspaceRoot: string, name: string): Promise<Persona | undefined>;
export async function loadPolicyText(workspaceRoot: string): Promise<string>;
```

- **Deliberate deviation from the `review-profiles.json`/`DEFAULT_AGENT_SUITE` seed-on-first-read
  precedent:** `loadPersonaManifest`/`loadPersona`/`loadPolicyText` are pure reads that return
  empty/undefined when `agents/` doesn't exist — they never write anything. Auto-seeding on first
  read is right for an explicit, feature-specific command like `ctxhub review`, but wrong here,
  since `loadPolicyText` gets called from everyday commands (`explain`, `ask`, `handoff`) that
  would otherwise silently create a new top-level directory just from normal use. Only the explicit
  `ctxhub personas init` command writes anything.
- `loadPolicyText()` returns `''` when no policies are configured. Each of the six commands' own
  existing evidence-block wording (the `[ref]`/`repo:path`/component-specific header line) stays
  exactly as it is today — the policy block is a **new, additional, optional** section added ahead
  of it in the prompt, not a replacement. An empty policy block means nothing new is added at all.
- New CLI: `ctxhub personas init` scaffolds the directory (or folds into `ctxhub onboard` as an
  optional step — decide during implementation based on how heavy onboarding already feels).

**Not consolidation by deletion:** the six existing strings are genuinely different (an `[ref]`
label scheme for `explain`, `repo:path` for others, "components and edges" for `diagram`) because
each command's evidence has a different shape — they are not byte-identical duplicates safe to
merge into one replacement string. What's actually duplicated is the underlying *principle*, not
the wording. The fix is additive: one shared, git-tracked, team-editable policy statement that
supplements (not replaces) each command's own existing evidence-format instructions, so a team can
strengthen evidence discipline in one place without touching six files, while the fallback (no
`agents/policies/` configured) leaves every existing command byte-for-byte unchanged.

**Acceptance criteria:**

- `agents/` is git-trackable, human-editable Markdown/YAML, with no schema library dependency.
- Every existing LLM-backed command's prompt text is byte-identical to today's when no
  `agents/policies/` files exist (pure addition for anyone not opting in, not a behavior change).
- A team can add one policy file and see it reflected in every persona-aware command's prompt.

### Phase 2 — Wire personas into existing commands

- [x] `--as <persona>` option on `ctxhub explain`
- [x] `--as <persona>` option on `ctxhub ask`
- [x] `--as <persona>` option on `ctxhub handoff`
- [x] `ReviewerProfile` gains optional `persona?: string` field (backward compatible with existing `review-profiles.json` files)
- [x] Fixed prompt-assembly order implemented consistently: policy → persona → command instructions → evidence → query
- [x] Unit tests: persona text changes framing; citation/evidence discipline is identical with or without `--as`
- [x] Live verification: real CLI run (`explain`/`ask`, `--as architect`) showing visibly different, architecture-framed reasoning for the same query, while `[E1]`-only citation discipline held identically in both runs; an unknown `--as` value degrades gracefully (persona block silently omitted, no crash)

- Add optional `--as <persona>` to `explain`, `ask`, and `handoff` (mirroring the flag `review`
  already has).
- Generalize `ReviewerProfile` in `review.ts`: keep `kind`/`focus` exactly as-is (backward
  compatible with any `review-profiles.json` a team has already customized), add an optional
  `persona?: string` field. When present, `loadPersona()` resolves it and its full body is included
  in the assembled prompt alongside (not instead of) `focus`.
- Fixed assembly order for every persona-aware prompt, adapting APS's own precedence rule to what
  ctxhub actually builds per call:

  ```text
  policy text (always, not overridable)
      >
  persona text (if --as given)
      >
  command-specific instructions (what explain/review/handoff already construct)
      >
  evidence (context pack / diff / architecture — unchanged)
      >
  user's query/topic
  ```

**Acceptance criteria:**

- `ctxhub explain "how does checkout work" --as architect` produces a visibly different answer
  (framed around maintainability/complexity per the architect persona) than the same call without
  `--as`, while citation discipline is provably identical either way — proving a persona's `focus`
  text cannot loosen the evidence policy, matching APS's stated precedence rule.
- No existing test for `explain`/`handoff`/`ask`/`review` needs to change when `--as` is omitted.

### Phase 3 — Cross-harness compilation ("the adapter model")

**Scope decision (explicit, made with the user before building this):** Claude Code only gets the
real native-subagent treatment. Codex/Copilot/Cursor get the plain project-instructions fallback,
not a guessed-at native integration, until someone confirms those harnesses' own current docs say
otherwise.

- [x] Extend `HarnessCapabilities` (`src/llm/harness.ts`) with `nativeSubagents` and `projectInstructions`
- [x] Set `nativeSubagents: true` for `claude` only; `false` for Codex/Copilot/Cursor (unverified, not assumed) — pinned by a test so this can't silently drift
- [x] `ctxhub personas sync` command, reusing `skills.ts`'s per-agent target-root pattern (including the same workspace-root-write + symlink-into-child-repos behavior)
- [x] Claude Code adapter: writes `.claude/agents/<persona>.md` with `name`/`description` frontmatter
- [x] Fallback adapter: plain instructions file (`.agents/personas/`, `.github/personas/`, `.cursor/personas/`) for Codex/Copilot/Cursor
- [ ] `ctxhub doctor` drift detection for installed persona files (stale vs. `agents/personas/*.md` source) — not built in this pass, tracked as a follow-up
- [x] Unit tests for the sync/compile logic per harness (native vs. fallback content, no-personas-configured guidance, unsupported-agent rejection, workspace-root + child-repo symlinking)
- [x] Live verification: `claude --agent architect -p "..."` against a real compiled `.claude/agents/architect.md` produced a response that directly reflected the persona's identity and near-verbatim its "six months from now" quality-gate language — this is the real Claude Code binary recognizing and using the compiled file, not just ctxhub writing a file that looks plausible

Extend `HarnessCapabilities` (`src/llm/harness.ts`) with two new fields:

```ts
export type HarnessCapabilities = {
  mcpConfig: boolean;
  skills: boolean;
  headlessInvocation: boolean;
  nativeSubagents: boolean;      // a distinct, file-defined sub-agent/context the harness can delegate to on its own
  projectInstructions: boolean;  // a plain project-level instructions file the harness reads (fallback target)
};
```

**Confidence per harness — verify before shipping, don't trust this table blindly:**

| Harness | `nativeSubagents` | Evidence |
| --- | --- | --- |
| Claude Code | ✅ **True, high confidence** | `.claude/agents/<name>.md` with YAML frontmatter (`name`, `description`, `tools`, `model`) and the Markdown body as the subagent's system prompt — a real, documented feature. |
| Codex | ❓ **Unverified — mark false until confirmed** | No confirmed equivalent file-based subagent delegation as of this writing. Treat as `projectInstructions`-only (e.g. an `AGENTS.md`-style file) until Codex's own docs confirm otherwise. |
| Copilot | ❓ **Unverified — mark false until confirmed** | Same treatment; verify against current Copilot CLI/agent docs before flipping this to true. |
| Cursor | ❓ **Unverified — mark false until confirmed** | Cursor has rules/modes; whether these constitute a discrete per-persona native file format needs a direct check against current Cursor docs, not assumption. |

**New command:** `ctxhub personas sync` (mirrors `ctxhub skills install`'s exact mechanism — same
per-agent target-root pattern already in `skills.ts`'s `SKILL_TARGET_ROOTS`):

- Where `nativeSubagents` is true: write one file per persona in the harness's native format
  (`.claude/agents/<persona>.md` for Claude Code, correctly shaped frontmatter + body). Claude
  Code's schema also supports optional `tools`/`model` fields; ctxhub's compiler only sets the
  required `name`/`description` for now (inherit-all-tools, default-model), which is enough to
  prove the adapter works -- `tools`/`model` support is a small, natural follow-up, not core to
  this phase. ctxhub remains the canonical source (`agents/personas/*.md`); the harness-native
  file is a compiled, regeneratable artifact — same relationship `ctxhub skills install` already
  has between
  its `skills/<agent>/<id>/SKILL.md` templates and what gets written into a workspace.
- Where only `projectInstructions` is true: write a plain instructions file the harness reads,
  presenting the persona as guidance text rather than a runtime-enforced subagent. Implemented as
  one file per persona under a harness-specific root (`.agents/personas/`, `.github/personas/`,
  `.cursor/personas/`), mirroring `skills.ts`'s existing per-agent target-root pattern exactly,
  rather than trying to append into a single shared instructions file per harness.
- `ctxhub doctor` drift detection for installed persona files (matching what it already does for
  skills/MCP config) was **not** built in this pass -- noted as a real follow-up, not silently
  dropped, since it wasn't required to prove the core adapter model works.

**Acceptance criteria:**

- `ctxhub personas sync` produces a real `.claude/agents/architect.md` file. Verified live: not
  just that the file looks structurally right, but that the actual `claude` CLI
  (`claude --agent architect -p "..."`) picked it up and responded in the persona's voice,
  including near-verbatim language from the persona's own text -- proof the real harness reads and
  uses the compiled file, not an assumption about its format.
- Every harness gets *something* (native subagent or project-instructions fallback) — never a
  silent no-op for an unsupported harness.

### Phase 4 — Structured findings (smaller, later increment)

- [ ] Wire `computeConfidence()` into the `contract`/`docs` review finding paths

`ctxhub review`'s `contract`/`docs` persona kinds already produce structured findings
(`ContractRisk`, `DriftRepairSuggestion`) with real provenance `computeConfidence()` could score
today. `generic` (freeform LLM) findings don't have per-line provenance to score yet. This phase is
optional polish — wiring `computeConfidence()` into the `contract`/`docs` finding paths — not
required for personas to ship.

## Explicitly out of scope (and why)

Not tracked with checkboxes above — these are separate decisions if ever picked up, not phases of
this plan.

- **Composition Pipeline / Persona Resolver / live context injection during an agent's own turn** —
  requires ctxhub inside the execution loop; the control-plane brief itself lists this ("does
  ctxhub shell out to agent CLIs for its own inference, or stay purely read/route/orchestrate") as
  an unresolved, bigger question for a later phase, not something to decide by building it here.
- **Native sub-agent delegation orchestration** — real architectural step-up per
  `SUBAGENTS_BRAINSTORM.md`'s own framing; a separate decision with its own cost/risk analysis.
- **Rooms as a distinct cross-repo scoping primitive** — genuinely useful (a named,
  cross-repo slice of context, e.g. "security" spanning every repo's security-relevant globs) but
  not required for personas to work; `context_pack`'s existing per-repo/per-type scoping is enough
  for Phase 1-3. Worth a follow-up once a concrete cross-repo-room need shows up in practice.
- **Execution Profiles, gateway adapters (OpenRouter/Bedrock/LiteLLM)** — belongs to
  `ctxhub-AI-Control-Plane-Recommendations.md`, a different layer of the stack entirely.
- **`persona.schema.json` formal validation** — a reasonable stretch goal once the Markdown persona
  format has stabilized through real use, not a blocker to shipping Phase 1.

## What this looks like in practice, end to end

1. A team runs `ctxhub personas init`, gets `agents/personas/architect.md` and
   `agents/policies/evidence.md` scaffolded, and edits the architect persona to reflect their own
   engineering principles.
2. A developer runs `ctxhub explain "why is checkout slow" --as architect` from the terminal — same
   evidence-grounded answer as plain `explain`, but framed through the architect persona's stated
   decision framework, with citation discipline unchanged (the policy layer, not the persona,
   controls that).
3. The team runs `ctxhub personas sync`. In a Claude Code workspace, this writes
   `.claude/agents/architect.md`, and Claude Code's own subagent picker can now delegate
   architecture-flavored sub-tasks to it directly — no ctxhub process involved at that point, since
   execution is Claude Code's job, not ctxhub's. In a Codex/Cursor/Copilot workspace (pending the
   verification pass above), the same persona compiles down to project-instructions text instead.
4. `ctxhub doctor` flags it if `agents/personas/architect.md` is edited after `ctxhub personas sync`
   last ran, the same way it already flags stale skill files today.

Nothing in this flow requires ctxhub to run continuously, intercept another tool's execution, or
add a new provider/API-key dependency — it's the same "shell out, write files, get out of the way"
shape as everything else in the codebase today.
