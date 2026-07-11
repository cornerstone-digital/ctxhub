# Why ctxhub is shaped this way

*The mission is to turn every engineering decision into institutional knowledge. The principles are: open context, humans stay in control, knowledge compounds. This document explains how those commitments show up in specific technical decisions.*

See [architecture.md](./architecture.md) for *how* it's built, [quickstart.md](./quickstart.md) for how to get started, and [docs/strategy/PRINCIPLES.md](./strategy/PRINCIPLES.md) for the full principles.

---

## The design philosophy

**AI should feel like another engineer on the team — capable, helpful, and operating within boundaries the team has agreed on.**

Not a chatbot. Not an oracle. A colleague: one that works continuously, surfaces findings for review, earns more autonomy as trust grows, and whose output becomes part of the shared engineering record.

Every major product decision flows from this: Personas give AI a role and reasoning style. Captains give it recurring responsibilities. Missions let it execute multi-step work. Approvals keep humans in the loop. Mission Control makes the whole AI workforce visible. Memory makes what it learns persistent.

When a feature is unclear, ask: does this make the AI feel more like a trusted colleague, or does it make it feel more like a tool you invoke and forget?

---

## The context layer sits above the models

ctxhub is the context layer for AI engineering — the shared, structured understanding of a codebase that every AI agent needs but none of them maintain on their own. Every technical decision flows from that responsibility.

This means ctxhub is explicitly not a model provider, not an editor, and not a coding agent. It sits above all of those. When a Captain runs, ctxhub decides *what* to ask and *when* to ask it; the model call itself belongs to Claude, Codex, Copilot, Cursor, or a direct API gateway. This keeps ctxhub vendor-neutral and out of the business of hosting or wrapping inference.

New features that push ctxhub toward becoming a coding assistant or a model wrapper are misaligned. The question to ask is: does this extend the context layer, or does it add something that belongs elsewhere?

---

## Humans stay in control — by design, not by policy

The approval queue isn't a safety net bolted on after the fact. It's how trust gets built. Each time a human reviews a Captain finding and promotes it (or rejects it), they're calibrating how much the AI's judgement can be relied on next time.

This shows up in specific constraints:

- `ctxhub captain run` never writes to a repo. It writes to a pending-approval queue. Promotion is always a separate, human-invoked action.
- `ctxhub note promote` is the one explicit bridge between agent memory and team-shared notes — copying a MemPalace hit into a note is a deliberate decision, not something that happens implicitly.
- LLM features are opt-in (`llm.enabled: false` by default) and never the only path. Turning LLM off degrades a feature, it doesn't break it.

Automation that removes human review without first establishing trust is the wrong direction, even if it's faster. Earn the trust incrementally; extend autonomy as evidence accumulates.

---

## The index is a read-only mirror; memory is a separate writable layer

The index (LanceDB or `local-json`) mirrors what's in git. It is not a place for agents to stash notes. Mixing reviewed team knowledge with unverified agent scratchpad in the same search results makes both worse — a hit would carry ambiguous authority.

Two separate, purpose-built paths exist instead:

- **MemPalace** (or `local-json` fallback) for personal and session memory — durable across an agent's sessions, not shared with the team, not indexed.
- **`ctxhub note add`** for team-shared notes — git-tracked, shows up in PR diffs for review, indexed after merge.

`ctxhub note promote` is the explicit one-way bridge. A MemPalace finding becomes a team note only through a human decision.

---

## Local-first is a trust decision, not a performance decision

Nothing in ctxhub requires a network connection. This wasn't the easy default — it was chosen because a tool that quietly opens a network listener is a larger trust surface than one that operates entirely on your machine.

The same thinking applies to embeddings: lexical/full-text search covers a typical multi-repo doc+code corpus well enough that a second native-binary dependency for a local embedding model isn't justified by the improvement. Decided against, not deferred.

Mission Control (`localhost:7342`) is an exception: it runs locally on purpose, with no external data transmission.

---

## LLM features are opt-in, grounded, and fallback-safe

Every LLM-backed feature shares three properties:

1. **Off by default.** `llm.enabled: false` until a user turns it on.
2. **Evidence-grounded.** Prompts are built from ctxhub-gathered evidence (context packs, diffs, architecture graphs). Inventing a `repo:path` citation that wasn't in the evidence is treated as a bug, not a quality nuance.
3. **Non-LLM fallback.** Every LLM feature produces a useful result (the raw evidence bundle, the structured context) when disabled or unavailable. The LLM path enriches; it doesn't replace.

Confidence scoring follows the same discipline in reverse: scores are computed from real, inspectable signals (source type, recency, corroboration, doc/code agreement) — never from a model's self-reported confidence.

---

## One surface for humans and agents, not two products

Most features exist as both a CLI command and an MCP tool, because a person at a terminal and an agent through MCP need the same underlying answer. Building two separate implementations that could drift apart would undermine the whole premise.

Skills (`ctxhub skills install`) apply the same logic: they teach an agent *when* to reach for a tool it already has access to. Capability and usage guidance ship together.

---

## Don't reimplement what already works

ctxhub shells out to MemPalace's real engine for durable memory rather than reimplementing search, storage, and timeline logic itself. `ctxhub review`'s `contract` and `docs` personas reuse `pr-context`'s risk review and `graph --drift`'s repair suggestions unmodified. New surface area is for genuinely new capability, not for wrapping something that already works well.

The test: if removing this code would make an existing, working thing worse, it's wrapping. If removing it would leave a gap that nothing else fills, it's new capability.
