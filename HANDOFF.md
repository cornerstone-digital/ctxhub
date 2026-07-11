# Handoff — ctxhub Mission Control session

Session ran out of budget mid-flow. Everything below is **committed and in a working state**
(512/512 backend tests pass, `npm run build` clean, `ui/e2e` suite was 10/10 passing as of the
last full run). This file is meant to be read once by the next agent and then deleted.

## What just happened (reverse-chronological, most recent first)

1. Built a real Playwright Test e2e suite (`ui/e2e/`) covering Fleet, Knowledge, Chat, Captains,
   Config, Skills & Personas, Review — against a real running service, no mocks. Fully isolated
   (disposable copy of `examples/reference-workspace`, isolated `CTXHUB_HOME`, port 7343 separate
   from the real service's 7342). Run with `npm run test:e2e` from repo root.
2. Added a full **Review screen** to Mission Control (`ui/src/components/ReviewView.tsx`) —
   previously `ctxhub review --as <persona>` was CLI-only. Backend: extracted
   `createReviewResult` from `reviewCommand` (`src/commands/review.ts`) and added
   `GET /workspaces/:name/review-profiles` + `POST /workspaces/:name/review` to `server.ts`.
3. Fixed a real bug in `LanceDbIndex.recent()`/`search()`: both had a hardcoded inner
   `.limit(10000)` applied *before* sorting by recency, so any workspace over 10000 chunks would
   silently sort/truncate over an arbitrary subset. Fixed by removing the limit entirely (a plain
   LanceDB query has no default limit when `.limit()` is omitted). Also raised
   `knowledgeGraph.ts`'s scan limit from 3000 → 20000 (`MAX_INDEXED_DOCS_SCANNED`) since this repo's
   own workspace (2211 chunks, 259 files) was already close to the old 3000 ceiling.
4. Fixed a real UX bug caught *by* the new e2e suite: `CaptainsView.tsx`'s `PromoteForm` called
   `onDone()` (collapsing the form) in the same tick as `setResult()`, so a successful promote's
   confirmation message never actually got a chance to render — the form just vanished.
5. Earlier in the session (already committed, working): chat markdown rendering, citation→Knowledge
   graph deep links, resolvable-vs-not citation styling, Obsidian-style uncapped Knowledge graph
   with on-demand edge expansion (`expandKnowledgeGraphNode`), per-workspace chat history scoping
   fix, and a full docs/screenshot/demo-video pass. See `git log` for the full trail — commit
   messages are deliberately thorough.

## Known follow-ups (not started, or started-and-abandoned this session)

- **`ctxhub review` with the `docs` persona is slow against a large real workspace.** Tested
  directly against the real `ctxhub` workspace (259 files) and it took well over 30s — not broken,
  just slow (does multiple searches for architecture-drift analysis). Never profiled *why*; worth
  checking whether `reviewDocsPersona` (`src/commands/review.ts`) is doing redundant search calls
  or could be parallelized. Not blocking — the e2e test suite deliberately uses the `docs` persona
  against the tiny fixture workspace where this isn't an issue.
- **No Review screenshot in the docs.** I captured one attempt (`docs/images/dashboard-review.png`)
  against the real ctxhub workspace but it got deleted when I ran out of time waiting on the slow
  `docs` persona review above. The README's Mission Control section currently describes Review in
  text only, no image — every other screen has one. Worth adding once the slowness above is
  understood (or just capture against the fast `bug-hunter`/`security` persona instead, or against
  a workspace with a real git diff so "Changed files"/"Findings" aren't empty in the screenshot).
- **`removeCaptainTask` doesn't clean up run history.** Found this while investigating debris in
  `~/.ctxhub/captains/` (already cleaned up with user approval — see git history, not a lingering
  issue). But the underlying gap is real: removing a task's definition from `captains.json` leaves
  its `~/.ctxhub/captains/<name>/` run-history directory orphaned forever, with no CLI command to
  discover or purge it. Decided *not* to auto-delete on `remove` (a user might genuinely want old
  run history after retiring a scheduled task) — the right fix is probably a `--purge-runs` flag on
  `ctxhub captain remove`, not implemented.
- **e2e suite is not wired into CI** (`.github/workflows/ci.yml`). Deliberately not done this
  session — it's heavier (needs Chromium, ~20s+ per run) and wasn't asked for. If added, it should
  be a separate job, not folded into the existing `test` job.
- **e2e suite has no video/trace capture enabled by default** (`retain-on-failure` only, to avoid
  accumulating artifacts on green runs). If someone wants demo footage generated *from* the e2e
  suite (rather than the separately-recorded `docs/videos/dashboard-demo.mp4`), flip
  `playwright.config.ts`'s `use.video` to `'on'` for a one-off run.
- **Two lucide-react icons don't resolve as named exports in this project's TS setup**:
  `Trash2` and `ShieldCheck` both fail with `TS2305: has no exported member` even though they're
  genuinely present in the package's `.d.ts` (confirmed via isolated single-file repro, ruling out
  anything project-specific). Root cause not fully understood — suspected but unconfirmed
  TypeScript issue with lucide-react's enormous single-line re-export statement. Workaround used
  both times: swap to a different icon that's already proven to work elsewhere in the codebase
  (`X`, `CheckCircle`). Before using *any* new lucide-react icon not already imported somewhere in
  `ui/src/`, sanity-check it first: drop a one-line `import { IconName } from 'lucide-react'` into
  a throwaway file under `ui/src/` and run `npx tsc --noEmit` from `ui/`.

## Things to double check before doing more work

- The **real** dashboard service (port 7342) was last restarted with the fully up-to-date build —
  should be fine, but if picking this up in a new session, `ctxhub service stop && ctxhub service
  start` (from repo root, after `npm run build`) to be safe.
- `HANDOFF.md` (this file) is untracked/uncommitted on purpose — delete it once read, don't commit
  it.
