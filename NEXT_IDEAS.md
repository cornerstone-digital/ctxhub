# Ideas to pick up next

A quick-resume note, written mid-session so there's a clear place to restart from after a pause.
Not a duplicate of `ROADMAP.md`/`docs/control-plane.md` — just a short pointer to what's live,
what's queued, and where the detail actually lives.

## Where things stand

All 7 phases of the original control-plane plan (`docs/control-plane.md`) are shipped and
committed, plus one fast follow (scheduled Captain triggers). ctxhub is now both the context/
memory fabric it always was and a personal orchestration framework: Workspace Registry, a local
control-plane service, a Fleet-view web UI, Execution Profiles (including a direct-API gateway
path with no harness CLI required), a Central MCP Gateway, and Fleet/Workspace Captains with real
approval gating and now scheduled triggers.

Every phase was live-verified against something real (a real detached process, a real stdio MCP
connection, the real `claude` CLI, and — for the gateway adapter — a genuinely external target via
a real local Ollama server). Full suite: 480/480 tests, clean build, clean lint. One real
concurrency bug was found and fixed along the way (overlapping scheduler polls racing each other's
writes) — see `docs/control-plane.md`'s Phase 6 section for the story.

## Control-plane fast follows (not yet built, all explicitly tracked)

From `ROADMAP.md`'s "Planned" section and `docs/control-plane.md`'s "Explicitly out of scope":

- **`--profile` on `ask`/`handoff`/`review`** — `explain` already has the full Execution Profile
  wiring (Phase 4); the other persona-driven commands can adopt the identical pattern. Small,
  mechanical, low-risk. Probably the fastest next pick if continuing this track.
- **Approvals queue surfaced in the Fleet view UI** — `ctxhub captain approvals`/`promote` are
  CLI-only today; showing pending runs on the Phase 3 web page would tie two already-shipped
  phases together. Read-only on the page for now (writing to a repo from a browser is a bigger
  trust boundary worth its own decision).
- **AWS Bedrock and Anthropic-direct gateway adapters** — Phase 7's remaining scope. Bedrock
  specifically needs real input about VF3's actual AWS setup (IAM, region, private connectivity)
  before it's worth designing, not something to guess at.
- **A guided `ctxhub provider add openrouter` onboarding wizard** — the underlying capability
  (a `direct-api` execution profile) already works via plain config; this would just be a thin
  paste-a-key UX layer on top.
- **OS-level service registration** (`ctxhub service install` for launchd/systemd) — deliberately
  deferred until the plain detached-process mode (`ctxhub service start`) has proven itself over
  time. Bigger commitment (platform-specific service files, install/uninstall hygiene) than
  anything else on this list.

## Non-control-plane backlog

- **OSS adoption kit, part 2 (`NEXT_FEATURES.md` #31b)** — the one item left from before the
  control-plane arc started. `31a` (docs split, reference workspace) is done; flipping
  `"npmPublish": false → true` in `.releaserc.json` is intentionally still gated on an explicit
  "yes, ready to be public on npm" decision from whoever owns that call, not an autonomous one.
- **`SUBAGENTS_BRAINSTORM.md`'s A-track** (A1–A3) — skill-doc-only guidance, never built, flagged
  in that file as "nearly free" (a few sentences in the skill files, no code): fan-out guidance
  for genuinely cross-cutting/cross-repo questions, a blast-radius check before finishing a
  cross-repo change, and digesting large handoff/PR-context bundles via a summarizer sub-agent.
  Everything else in that file (B-track, C-track) is already shipped.

## If picking this up cold

Read `docs/control-plane.md` for the full phase-by-phase story and the reasoning behind each
decision; `ROADMAP.md`'s "Shipped" section has the terse version. `git log --oneline` shows one
commit per phase/feature, each with a live-verification note in the body.
