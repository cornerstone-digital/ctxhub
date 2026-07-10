# Sub-agents brainstorm

Discussion doc, not a commitment — ideas for where ctxhub could make use of sub-agents to
enhance the developer workflow, to pick through later. Nothing here is scheduled; anything
promoted out of this file should get its own entry in [NEXT_FEATURES.md](NEXT_FEATURES.md)
with proper acceptance criteria.

## Two different things "sub-agents" could mean here

Worth separating up front, because they have very different cost/risk profiles:

**A. ctxhub tells the *host* agent when to use its own sub-agents.** Claude Code, Codex, etc.
already have their own sub-agent/task-delegation mechanisms. This is pure skill-doc guidance —
no new ctxhub code, no new dependency, no API key, no cost. Same spirit as the existing
`memory_status` guidance that defers to MemPalace instead of reimplementing it.

**B. ctxhub spawns its own bounded sub-agent to do a piece of work.** This is a real
architectural step up — ctxhub goes from "read-only search/index/context server" to "thing that
occasionally runs an agent loop." [ROADMAP.md](ROADMAP.md)'s "Not planned" section already
rejects reimplementing agent capabilities MemPalace covers, and rejects heavier dependencies for
modest gains — so if we do B, the same instinct applies: **shell out to whichever agent CLI the
workspace already has configured (`claude -p`, `codex exec`, etc.) rather than adding an
Anthropic/OpenAI SDK dependency and our own API key management.** ctxhub already knows which
agent is configured per workspace (`ctxhub agent <name>`); reusing that CLI headlessly means no
new credential surface and no new dependency, at the cost of being slower and shelling out to a
child process per call.

Everything below is tagged with which of these it is, plus a rough effort/risk tier.

## A-track ideas (skill-doc guidance only — cheap, low-risk)

### A1. Fan-out guidance for genuinely cross-cutting questions

When a question spans many repos and a single `context_pack` call doesn't resolve it (e.g. "how
does auth propagate across all five services"), tell the host agent to delegate one sub-agent per
candidate repo (seeded with that repo's `search`/`architecture_search` hits) rather than grepping
every repo inline and bloating its own context window. ctxhub already identifies *which* repos are
candidates via `repo_list`/`search`; it just needs to say so in the skill.

### A2. Blast-radius check before finishing a cross-repo change

Before an agent says "done" on a change that touches a shared interface, suggest delegating a
sub-agent per downstream consumer repo (found via `architecture_map`/`search`) to check nothing
broke, instead of doing that fan-out serially in the main conversation.

### A3. Digest large handoff/PR-context bundles

`ctxhub handoff`/`ctxhub pr-context` bundles can get large. For a big bundle, suggest handing it
to a summarizer sub-agent first rather than reading the whole thing into the main agent's context.

**Effort:** trivial — a few sentences in the skill files, mirroring the phrasing already used for
`server_status`/`usage_stats`. Good first candidate since it's nearly free.

## B-track ideas (ctxhub runs its own bounded sub-agent — real scope, real cost)

### B1. LLM-backed `ctxhub explain`

Already has a door left open for this in NEXT_FEATURES.md #1 ("later add an optional
provider-backed summarizer, gated behind config"). A sub-agent fed the context pack writes the
cited answer instead of the current non-LLM grouped-results scaffold. Natural first B-track
candidate since it's already scoped and opt-in by design.

### B2. Formalize the ad-hoc skill/doc test-report loop

This is the most validated idea on this list — we've been doing a version of it by hand all
session: point an agent at a workspace, have it exercise ctxhub's skills against real questions,
and write findings to a report file. Worth turning into `ctxhub eval --agent-report` or similar:
spawn the configured agent CLI headlessly against a fixed set of real workspace questions, capture
where it reached for the wrong tool or got a bad answer, and produce the same kind of report we've
been iterating on by hand in the VF3 workspace. Directly reuses a workflow we already know works.

### B3. Architecture/doc drift repair suggestions

`ctxhub graph --drift` already *detects* diagrams/docs that no longer match repo reality. A
sub-agent could read the drifted diagram plus current code and propose a patch — output as a
suggested diff for human review via the existing `ctxhub diagram add` scaffolding model, never
auto-applied.

### B4. Tailored onboarding for newly discovered repos

When `ctxhub repo discover`/`repo add` picks up a new repo, today it gets the generic default
`knowledge.include/exclude` globs. A sub-agent could explore the repo once and propose
repo-specific globs plus a starter architecture diagram, instead of the one-size-fits-all default.

### B5. Cross-repo contract-break PR reviewer

Given a diff in one repo, a sub-agent uses ctxhub's index to find likely consumers in sibling
repos and flags contract risk (shape changes, removed endpoints, etc.) as a handoff artifact or PR
comment draft.

### B6. Standalone `ctxhub ask "<question>"`

Wraps `context_pack` + a one-shot summarizer sub-agent into a single terminal command, so ctxhub is
useful to a developer with no agent harness open at all — not just as an MCP backend for one.

## Context compaction

Sub-agents and compaction solve the same underlying problem — too many tokens going into an
agent's context for what it actually needs — so they belong in the same discussion. A few of
these are non-LLM and cheap (verified, not speculative); a couple are the LLM-backed version of
ideas already listed above.

**Update 2026-07-10: C1 + the TOON/JSON auto-pick are shipped.** `src/mcp/server.ts`'s
`textResult()` — the single choke point every tool response passes through — now calls
`compactEncode()` (`src/mcp/compact.ts`), which strips redundant `content` whenever a `snippet`
sibling exists, then encodes as whichever of TOON or compact JSON comes out smaller for that
specific payload (a uniform result array picks TOON; `context_pack`'s mixed shape picks JSON —
verified both actually happen). `usage_stats`/`ctxhub stats` now measure the real post-compaction
text, not the pre-compaction payload, so the savings number reflects what's actually sent.
Verified against the real VF3 workspace: `context_pack` for the same query dropped from 42,630 to
22,448 characters (47% smaller) purely from this change. One real bug found and fixed along the
way: TOON's `decode()` doesn't reliably reject non-TOON text — it silently misparses plain JSON
instead of throwing — so any code trying to auto-detect the format must try `JSON.parse()` first
(it throws reliably on real TOON text) and fall back to `decode()`, not the other way around.
C2-C5 below are still just brainstormed, not built.

### Surveyed github.com/topics/context-compression (2026-07-10)

Skimmed the ~20 repos listed there. Most are small (20-60 stars), unproven, wrong stack for us
(Python CLIs/proxies — `squeez`, `token-reducer`, `mnemosyne`), or solving an adjacent problem we
already have an answer for (`codex-agent-mem` is exactly the MCP-memory-layer reimplementation
[ROADMAP.md](ROADMAP.md) already declined in favor of MemPalace). One genuine standout:

**`@toon-format/toon`** (toon-format/toon, 24.8k stars, MIT, TypeScript, zero runtime deps,
~120KB unpacked, actively maintained). TOON ("Token-Oriented Object Notation") is YAML-style
nesting plus CSV-style tabular arrays — its stated sweet spot is *"uniform arrays of objects,
same structure across items,"* which is exactly what a ctxhub `search`/`architecture_search`
result list is. Their own benchmark: the same data as pretty JSON costs 4,587 tokens vs TOON's
2,759 (≈40% fewer) across 4 models, with slightly *better* retrieval accuracy (76.4% vs 75.0%),
not just fewer tokens for a quality tradeoff. API is a one-line `encode(value)` swap-in.

**The catch, checked before getting excited:** `src/mcp/server.ts`'s `textResult()` currently does
`JSON.stringify(value, null, 2)` for *every* tool response, and our own tests
(`firstTextPayload` in `src/mcp/server.test.ts`, used by nearly every MCP test) `JSON.parse()`
that text back. Swapping the wire format is a real behavior change, not a free lunch — every test
using `firstTextPayload` would need a `decode()` counterpart (TOON ships one), and any agent that
currently assumes ctxhub's tool text is JSON-parseable (some might, since today it obviously is)
would need to stop assuming that. Not a blocker, just needs to be a deliberate decision rather than
a silent swap — e.g. worth prototyping against one tool (`search` is the highest-volume, most
tabular one) before converting all of them.

### C1. Stop shipping full chunk content alongside the snippet — DONE (see update above)

Checked this while writing the doc: `search`/`context_pack` results spread the whole
`IndexedDocument` (`src/mcp/server.ts`'s `results.map(result => ({ ...result, ... }))`), which
includes the raw `content` field — the *entire* indexed chunk, up to `chunkSize` (1800 chars,
~450 tokens by default) — in addition to the `snippet` (360 chars, ~90 tokens) that's actually
meant for orientation (`createSnippet` in `src/indexing/LocalJsonIndex.ts`). Every result already
ships ~5x more text than the tool description promises ("ranked chunks with repo, path, type,
heading, snippet, commit" — it doesn't mention full content, because it isn't supposed to need
it). Dropping `content` from `search`/`architecture_search`/`context_pack` results by default
(agents already have `open_chunk`/`get_file_context` as the explicit follow-up for full text)
should cut returned tokens substantially with no loss of capability, and directly moves the
`usage_stats` savings numbers we just added in the right direction — this is worth pulling into
its own NEXT_FEATURES entry now rather than leaving it in a brainstorm file.

### C2. Token-budget-aware trimming instead of a flat result `limit`

`context_pack`/`search` currently take a `limit` (item count) but no token budget, so a handful of
large chunks can still blow past what's reasonable. Now that `estimateTokens` exists
(`src/utils/tokenEstimate.ts`, added for `usage_stats`), a `maxTokens` option could greedily keep
highest-scoring results until the budget is spent, then note how many lower-ranked results were
dropped (with their ids, so an agent can still `open_chunk` one deliberately if it wants to).

### C3. De-dupe across `context_pack`'s own sections

`createContextPack` runs `search` and the architecture sub-query independently and concatenates
them (`src/context/pack.ts`); a file matching both currently ships its content twice. Cheap,
mechanical fix: dedupe by chunk id across `search`/`architecture` before returning.

### C4. "Already seen" delta mode

Nothing today stops an agent from calling `search` twice for overlapping queries and getting the
same chunk's full content re-sent each time. Since MemPalace already gives ctxhub a durable,
per-session write surface, a lightweight seen-chunk-id set could back an `excludeSeen: true` flag
(or just default behavior) so repeat/overlapping queries don't re-ship content the agent already
has in its context. This is the same instinct behind Claude Code's own conversation compaction,
scoped down to "don't resend what I already gave you."

### C5. Index-time summaries for large files (LLM-backed — overlaps B-track)

For files that chunk into many pieces, index one extra cheap "file summary" chunk alongside the
regular chunks, so broad orientation queries can return the summary first and only pull full
chunks via follow-up. Non-LLM version: first-heading + symbol-name list (mechanical, cheap). LLM
version: a sub-agent-written summary at index time — same cost/risk profile as B1, so it should
ride on whatever decision gets made about running an agent CLI from ctxhub at all.

**Suggested order:** C1 is essentially free and already verified — worth doing regardless of what
happens with the rest of this doc. A TOON prototype on `search` alone is the next thing worth
actually spiking, since the numbers (40% fewer tokens, no accuracy loss) are the most concrete
evidence in this whole document. C3 and C2 are natural next steps in the same non-LLM, low-risk
tier. C4 and C5 are more involved and can wait for the broader sub-agent-usage decision.

## Open questions for the actual discussion

- Do we want ctxhub running LLM calls *at all*, even via a shelled-out CLI the user already pays
  for? It's a real philosophical line to cross vs. "read-only index/context server."
- If yes: opt-in only (a config flag / explicit `--agent` flag per command), never on by default,
  and never in `ctxhub doctor`/`sync`/anything that already runs unattended.
- CI usage (B2 especially) means an agent CLI running unattended in a pipeline — needs its own
  credential/cost/blast-radius thinking separate from interactive local use.
- Worth prototyping B2 first specifically *because* we already have hand-validated evidence it
  produces useful findings (this session's VF3 skill test reports) — lowest-uncertainty starting
  point of the list.
