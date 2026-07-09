# Next Feature Backlog

This is the practical implementation queue for ctxhub ideas that would make the tool more useful for both developers and agents. Each item is intentionally shaped so it can become one focused PR.

## Progress

- [ ] Cited explain command
- [x] CI workflow templates
- [ ] Context pack export and replay
- [ ] Interactive workspace viewer
- [ ] Rich Mermaid validation
- [ ] Architecture drift detection
- [ ] Agent handoff bundles
- [ ] Config doctor fix mode
- [ ] Search quality dashboard
- [ ] Source-aware context expansion

## 1. Cited Explain Command

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

**Command:** `ctxhub ui`

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

- Viewer shows repos, index status, architecture diagrams, recent chunks, and stale results.
- Works without external services.
- Does not expose a network listener by default unless explicitly requested.

## 5. Rich Mermaid Validation

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

- Given a line inside a function, context expansion returns the full function when possible.
- Falls back to current before/after line behavior when parsing fails.
- MCP schema stays backwards compatible.

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
