# Sub-agents brainstorm

Discussion doc, not a commitment — ideas for where ctxhub could make use of sub-agents to
enhance the developer workflow, to pick through later. Nothing here is scheduled; anything
promoted out of this file should get its own entry in [NEXT_FEATURES.md](NEXT_FEATURES.md)
with proper acceptance criteria.

## Scoring legend

Every idea below is tagged **Impact** and **Effort**, since "make use of sub-agents" isn't a
goal on its own — the business case is developer time saved, incidents avoided, LLM/token cost
saved, or faster ramp-up for new team members. Scores are judgment calls, not measurements
(except where noted "measured" — those come from an actual run, not an estimate).

- **Impact:** Low / Medium / High — how much of those four things (time, incidents, cost,
  ramp-up) this would realistically move if built and actually used.
- **Effort:** Trivial / Low / Medium / High — rough build cost, independent of track. A-track
  items are cheap by construction (skill docs only); B/C-track effort varies a lot within the
  track, so it's scored per item, not inherited from the track label.

## Scorecard

| # | Feature | Track | Impact | Effort | Benefit a user would see |
| --- | --- | --- | --- | --- | --- |
| A1 | Fan-out guidance for cross-cutting questions | A | Medium | Trivial | More complete cross-repo answers without the agent running out of context mid-investigation |
| A2 | Blast-radius check before finishing a cross-repo change | A | High | Trivial | Cross-repo breakage caught before merge, not after |
| A3 | Digest large handoff/PR-context bundles | A | Low-Med | Trivial | Faster, cheaper review of large handoff bundles |
| B1 | LLM-backed `ctxhub explain` | B | Medium | Medium | Readable, cited answers from the terminal with no agent harness open |
| B2 | Formalize skill/doc test-report loop | B | High | Medium | Skill/doc gaps caught continuously instead of by accident |
| B3 | Architecture/doc drift repair suggestions | B | Med-High | Med-High | Architecture docs stay trustworthy without someone manually policing them |
| B4 | Tailored onboarding for new repos | B | Medium | Medium | Better search quality in a newly added repo from day one |
| B5 | Cross-repo contract-break PR reviewer | B | High | High | Fewer cross-service breaking-change incidents |
| B6 | Standalone `ctxhub ask "<question>"` | B | Medium | Low-Med | ctxhub useful with no agent harness open at all |
| B7 | Auto-draft note/diagram content on scaffold | B | Medium | Low-Med | Docs/diagrams actually get written instead of left as empty templates |
| B8 | PR/handoff description synthesis | B | Medium | Low-Med | Less time writing PR descriptions, more consistent quality team-wide |
| B9 | Eval golden-query expansion | B | Medium | Medium | Quality dashboard stays meaningful without manual query curation |
| B10 | NL query rewriting in front of search | B | Low-Med | Medium | Better results for loosely-phrased questions |
| B11 | "Orient me" onboarding narrator | B | High | Medium | Faster time-to-productivity for new team members |
| C1 | Content-dedup + TOON/JSON auto-pick | C | High (measured) | Done | 47% smaller responses, measured against the real VF3 workspace |
| C2 | Token-budget-aware trimming | C | Medium | Low | Predictable cost ceiling per call instead of occasional oversized responses |
| C3 | Dedupe across `context_pack` sections | C | Low-Med | Low | Free reduction whenever search/architecture results overlap |
| C4 | "Already seen" delta mode | C | Med-High | Medium | Savings compound the longer an agent session runs |
| C5 | Index-time summaries for large files | C | Medium | Med-High | Faster orientation on large files without opening every chunk |

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

**Impact: Medium.** A developer asking a broad cross-repo question gets a complete answer instead
of one that trails off because the agent burned its context grepping five repos serially.

### A2. Blast-radius check before finishing a cross-repo change

Before an agent says "done" on a change that touches a shared interface, suggest delegating a
sub-agent per downstream consumer repo (found via `architecture_map`/`search`) to check nothing
broke, instead of doing that fan-out serially in the main conversation.

**Impact: High.** This is incident prevention, not convenience — the user sees fewer "worked
locally, broke a consumer service" surprises after merge.

### A3. Digest large handoff/PR-context bundles

`ctxhub handoff`/`ctxhub pr-context` bundles can get large. For a big bundle, suggest handing it
to a summarizer sub-agent first rather than reading the whole thing into the main agent's context.

**Impact: Low-Medium.** Cheaper, faster review of a large handoff — a quality-of-life win, not a
correctness one.

**Effort:** trivial — a few sentences in the skill files, mirroring the phrasing already used for
`server_status`/`usage_stats`. Good first candidate since it's nearly free.

## B-track ideas (ctxhub runs its own bounded sub-agent — real scope, real cost)

### B1. LLM-backed `ctxhub explain`

Already has a door left open for this in NEXT_FEATURES.md #1 ("later add an optional
provider-backed summarizer, gated behind config"). A sub-agent fed the context pack writes the
cited answer instead of the current non-LLM grouped-results scaffold. Natural first B-track
candidate since it's already scoped and opt-in by design.

**Impact: Medium.** A developer working solo in a terminal (no agent harness open) gets a real
answer instead of a grouped-results scaffold they have to read and synthesize themselves.

### B2. Formalize the ad-hoc skill/doc test-report loop

This is the most validated idea on this list — we've been doing a version of it by hand all
session: point an agent at a workspace, have it exercise ctxhub's skills against real questions,
and write findings to a report file. Worth turning into `ctxhub eval --agent-report` or similar:
spawn the configured agent CLI headlessly against a fixed set of real workspace questions, capture
where it reached for the wrong tool or got a bad answer, and produce the same kind of report we've
been iterating on by hand in the VF3 workspace. Directly reuses a workflow we already know works.

**Impact: High.** This is QA for the thing that decides whether every other feature on this list
actually gets used correctly — skill/doc regressions get caught continuously instead of by luck.

### B3. Architecture/doc drift repair suggestions

`ctxhub graph --drift` already *detects* diagrams/docs that no longer match repo reality. A
sub-agent could read the drifted diagram plus current code and propose a patch — output as a
suggested diff for human review via the existing `ctxhub diagram add` scaffolding model, never
auto-applied.

**Impact: Medium-High.** Architecture docs stay trustworthy without a human noticing drift
first — and every other ctxhub feature (search, context_pack, onboarding) is only as good as
the trust developers place in what it returns.

### B4. Tailored onboarding for newly discovered repos

When `ctxhub repo discover`/`repo add` picks up a new repo, today it gets the generic default
`knowledge.include/exclude` globs. A sub-agent could explore the repo once and propose
repo-specific globs plus a starter architecture diagram, instead of the one-size-fits-all default.

**Impact: Medium.** Better search/index quality in a newly added repo from day one, instead of
whatever the generic default globs happen to catch.

### B5. Cross-repo contract-break PR reviewer

Given a diff in one repo, a sub-agent uses ctxhub's index to find likely consumers in sibling
repos and flags contract risk (shape changes, removed endpoints, etc.) as a handoff artifact or PR
comment draft.

**Impact: High.** Directly prevents the expensive-to-debug-after-the-fact incident: a breaking
change in one service quietly taking down another that consumed it.

### B6. Standalone `ctxhub ask "<question>"`

Wraps `context_pack` + a one-shot summarizer sub-agent into a single terminal command, so ctxhub is
useful to a developer with no agent harness open at all — not just as an MCP backend for one.

**Impact: Medium.** Broadens who ctxhub is useful to — someone who doesn't have (or want) an
agent harness open still gets a real answer from the terminal.

### B7. Auto-draft note/diagram content on scaffold

`ctxhub note add`/`ctxhub diagram add` currently scaffold an empty, dated template for a human or
agent to fill in. A sub-agent could draft the first pass — pulling from recent commits, the
relevant context pack, or the diagram's surrounding code — leaving a human/agent to review and
edit rather than write from a blank page.

**Impact: Medium.** The blank-template step is a real reason team docs/diagrams don't get
written at all; lowering that activation energy means more of the workspace actually stays
documented over time, not just the parts someone had time to write from scratch.

### B8. PR/handoff description synthesis

Given a diff plus the relevant context pack, a sub-agent drafts a PR description or
`ctxhub handoff` summary — the same kind of synthesis this very session does at the end of a
task — instead of a developer or agent writing it from scratch each time.

**Impact: Medium.** Saves real per-PR time and produces more consistent description quality
across a team, regardless of who's writing it or how rushed they are.

### B9. Eval golden-query expansion

`ctxhub eval`'s quality dashboard is only as good as its golden query set, which today needs a
human to curate and keep current. A sub-agent could propose new golden queries from real search
patterns or common questions in a workspace, expanding coverage without that manual drag.

**Impact: Medium.** Keeps the eval/quality signal meaningful as a workspace evolves, instead of
slowly going stale because nobody had time to add new golden queries.

### B10. Natural-language query rewriting in front of `search`

Loosely-phrased questions don't always map well to ctxhub's search facets. A lightweight LLM pass
could rewrite a vague question into a better-scoped query (facet + keywords) before running
`search`, sitting in front of the tool rather than changing it.

**Impact: Low-Medium.** A modest per-query quality bump, mostly valuable for less experienced
users who haven't learned how to phrase a good ctxhub query yet.

### B11. "Orient me" onboarding narrator for new team members

Extend `ctxhub explain`/`ctxhub ask` into an orientation mode: a new engineer joining a repo or
team runs one command and gets an LLM-authored narrative synthesizing architecture, ownership,
and recent activity — not a static list of commands to run themselves.

**Impact: High.** The clearest, least ambiguous business case on this list: faster
time-to-productivity for a new hire is a concrete, easily-felt outcome, not a diffuse
"nice to have."

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

**Impact: High (measured).** Not an estimate — `context_pack` for the same real-workspace query
dropped from 42,630 to 22,448 characters (47% smaller) once this shipped. Lower LLM cost per
session and more of the agent's context budget left for actual reasoning instead of boilerplate.

### C2. Token-budget-aware trimming instead of a flat result `limit`

`context_pack`/`search` currently take a `limit` (item count) but no token budget, so a handful of
large chunks can still blow past what's reasonable. Now that `estimateTokens` exists
(`src/utils/tokenEstimate.ts`, added for `usage_stats`), a `maxTokens` option could greedily keep
highest-scoring results until the budget is spent, then note how many lower-ranked results were
dropped (with their ids, so an agent can still `open_chunk` one deliberately if it wants to).

**Impact: Medium.** Turns an occasional oversized response into a predictable cost ceiling per
call — the user doesn't need to guess `limit` low to avoid a surprise-large reply.

### C3. De-dupe across `context_pack`'s own sections

`createContextPack` runs `search` and the architecture sub-query independently and concatenates
them (`src/context/pack.ts`); a file matching both currently ships its content twice. Cheap,
mechanical fix: dedupe by chunk id across `search`/`architecture` before returning.

**Impact: Low-Medium.** Free reduction whenever a file happens to match both sub-queries — no
downside, just savings ctxhub is currently leaving on the table.

### C4. "Already seen" delta mode

Nothing today stops an agent from calling `search` twice for overlapping queries and getting the
same chunk's full content re-sent each time. Since MemPalace already gives ctxhub a durable,
per-session write surface, a lightweight seen-chunk-id set could back an `excludeSeen: true` flag
(or just default behavior) so repeat/overlapping queries don't re-ship content the agent already
has in its context. This is the same instinct behind Claude Code's own conversation compaction,
scoped down to "don't resend what I already gave you."

**Impact: Medium-High.** Unlike the other C items, this compounds — the longer and more
exploratory an agent session runs against a workspace, the more redundant re-sends it prevents.

### C5. Index-time summaries for large files (LLM-backed — overlaps B-track)

For files that chunk into many pieces, index one extra cheap "file summary" chunk alongside the
regular chunks, so broad orientation queries can return the summary first and only pull full
chunks via follow-up. Non-LLM version: first-heading + symbol-name list (mechanical, cheap). LLM
version: a sub-agent-written summary at index time — same cost/risk profile as B1, so it should
ride on whatever decision gets made about running an agent CLI from ctxhub at all.

**Impact: Medium.** Faster orientation on large, heavily-chunked files — a developer or agent
gets the gist in one hop instead of paging through several chunks to figure out what a file does.

**Suggested order:** C1 and the TOON/JSON auto-pick are done. C3 is the next natural pick in the
same non-LLM, low-risk tier — a trivial dedup fix with no downside. C2 follows it. C4 and C5 are
more involved and can wait for the broader sub-agent-usage decision (C5's LLM variant especially).

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
