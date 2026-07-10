# Next Feature Backlog

This is the practical implementation queue for ctxhub ideas that would make the tool more useful for both developers and agents. Each item is intentionally shaped so it can become one focused PR.

## Progress

- [x] Cited explain command
- [x] CI workflow templates
- [x] Context pack export and replay
- [x] Interactive workspace viewer
- [x] Rich Mermaid validation
- [x] Architecture drift detection
- [x] Agent handoff bundles
- [x] Config doctor fix mode
- [x] Search quality dashboard
- [x] Source-aware context expansion
- [x] LLM-backed features infrastructure + LLM-backed explain (opt-in, see README's "LLM-backed features")
- [x] Context compaction (dedup, token-budget trimming, already-seen delta mode, file summaries)
- [x] Agent-backed skill/doc test reports
- [x] Onboarding orientation narrator
- [x] Cross-repo contract-break PR reviewer
- [x] Architecture/doc drift repair suggestions
- [x] PR/handoff description synthesis (scoped to `ctxhub handoff`)
- [x] Auto-drafted note/diagram content
- [x] Tailored onboarding globs for new repos
- [x] Eval golden-query expansion
- [x] Standalone `ctxhub ask`
- [ ] Natural-language query rewriting in front of search
- [ ] LLM-authored file summaries at index time

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
order. None of these are built yet.

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

**Status:** Not started

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

- Response includes both the original and rewritten query when a rewrite happened.
- Never silently changes results without surfacing that a rewrite occurred.

## 21. LLM-Authored File Summaries at Index Time

**Status:** Not started

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

- Summary content is grounded in the actual file, no invented capabilities.
- Falls back to the non-LLM summary when disabled, unavailable, or the call fails/times out.
- Indexing a large workspace with `llm.enabled: false` (the default) is exactly as fast as today.

## Suggested Order

1. CI workflow templates
2. Context pack export and replay
3. Architecture drift detection
4. Rich Mermaid validation
5. Cited explain command
6. Agent handoff bundles
7. Search quality dashboard
8. Interactive workspace viewer
9. Config doctor fix mode
10. Source-aware context expansion

The first four strengthen trust in the index and architecture docs. The next three make ctxhub more useful in daily agent workflows. The final three are larger polish/maturity pieces.

The LLM-backed backlog (11-21) is sequenced separately above by validated confidence, not mixed into this list — see `SUBAGENTS_BRAINSTORM.md` for the full scorecard and reasoning.
