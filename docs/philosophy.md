# Why ctxhub is shaped this way

This is the "why," not the "how" (see [architecture.md](./architecture.md)) or the "what do I run
first" (see [quickstart.md](./quickstart.md)). A few decisions recur throughout the codebase and
are worth stating explicitly, since they explain choices that might otherwise look arbitrary.

## The index is a read-only mirror; memory is a separate, writable layer

ctxhub's own index (LanceDB or `local-json`) is deliberately **read-only** — a mirror of what's
actually in git, refreshed via `ctxhub sync`/a post-commit hook. It is not a place for an agent to
stash its own notes, and that's on purpose: mixing "official repo content" with "agent scratch
notes" in the same search results would make both worse — you'd never be sure whether a hit was
reviewed team knowledge or one agent's unverified aside from three sessions ago.

Two separate, purpose-built paths exist instead:

- **MemPalace** (or the `local-json` fallback) for personal/session memory — durable across an
  agent's own sessions, not shared with the team, not indexed by ctxhub.
- **`ctxhub note add`** for team-shared notes — a git-tracked file that shows up in a normal PR
  diff for review, and gets indexed like any other doc once merged.

`ctxhub note promote` is the one explicit, one-way bridge between them: copying a MemPalace hit
into a team note is a deliberate decision, not something that happens implicitly. See
[README.md#two-kinds-of-agent-memory](../README.md#two-kinds-of-agent-memory) for the concrete
command-level split.

## Local-first, no server, by default

`ctxhub report` writes one self-contained HTML file — no CDN assets, no local server, nothing that
needs to stay running. This wasn't the easy default; it was picked deliberately over spinning up a
live dashboard, because a workspace tool that quietly opens a network listener is a different (and
larger) trust surface than one that writes a file you can open, inspect, and delete. The tradeoff
this creates — a new free-text memory query needs a report regeneration, since a static file can't
run a new server-side search — is treated as an acceptable consequence of that choice, not a
compromise to quietly work around later.

The same bias shows up in the embeddings decision: lexical/full-text search already covers a
typical multi-repo doc+code corpus well, so ctxhub doesn't bundle a local embedding model as a
second native-binary dependency for what would be modest benefit on identifier-dense content. This
was decided against, not merely deferred (see [ROADMAP.md](../ROADMAP.md)).

## LLM features are opt-in, evidence-grounded, and never load-bearing

Every LLM-backed feature (`explain`, `pr-context`'s contract-risk review, `review`, `handoff`'s
summary, note/diagram drafts, and others) shares the same three properties:

1. **Off by default.** `llm.enabled: false` until a user turns it on.
2. **Grounded in evidence ctxhub already gathered** — a context pack, a diff, an architecture
   graph — never free-floating model knowledge. Prompts are explicit that only cited
   `repo:path` evidence may be used; inventing one is treated as a bug, not a quality nuance.
3. **Never the only path.** Every LLM-backed feature has a non-LLM fallback that still produces a
   useful result (the raw evidence bundle, the un-synthesized structured bundle) when disabled,
   unavailable, or timed out. Turning the LLM off should degrade a feature, not break it.

[NEXT_FEATURES #30](../NEXT_FEATURES.md)'s evidence-backed confidence scoring follows the same
discipline in the other direction: a score built from real, inspectable signals (source type,
recency, corroboration, doc/code agreement) — never a model's own self-reported confidence, and
never requiring an LLM call at all.

## One dual surface for humans and agents, not two products

Most features exist as both a CLI command and an MCP tool, because the two audiences (a person at
a terminal, an agent through MCP) need the same underlying answer, not two different tools that
could drift apart. `ctxhub agent <name>` and `ctxhub skills install` exist for the same reason from
the other direction: skills teach an agent *when* to reach for a tool it already has, so the
capability and the guidance to use it well ship together instead of one lagging the other.

## Don't reimplement what already does the job well

ctxhub shells out to MemPalace's real engine for durable memory rather than reimplementing search/
storage/timeline logic itself (see `src/memory/mempalaceCli.ts` and ROADMAP.md's "Not planned"
section). The same instinct applies to `ctxhub review`'s reviewer personas: `contract` and `docs`
reuse `pr-context`'s risk review and `graph --drift`'s repair suggestions unmodified rather than
re-deriving the same evidence a second way. New surface area is for genuinely new capability, not
for wrapping something that already works.
