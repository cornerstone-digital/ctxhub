# Contributing

Contributions are welcome — code, tests, documentation, blueprints, and bug reports all count. No contribution is too small.

## Where to start

Look for issues labelled [`good first issue`](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22) — each one has a clear definition of done and points to the relevant code. If you want to work on something, leave a comment so we don't duplicate effort.

Not sure what to work on? The most useful contributions right now are:

- Bug reports with a reproduction — a failing test case is even better
- Documentation improvements — anywhere the README or quickstart confused you is a valid target
- New Captain task definitions — share a `.yaml` that works well for your stack
- Blueprint proposals — a packaged set of personas + captain tasks for a specific framework or domain (see [Blueprints](#blueprints) below)

Read [ROADMAP.md](./ROADMAP.md) before proposing a large feature. Some things are deliberately not planned; the "What we are not optimising for" section explains the boundaries.

**Review SLA:** No PR sits unreviewed for more than 7 days. If yours has — ping in the issue.

---

## Codebase orientation

```
src/
  cli/         Commander.js program definition and entry point
  commands/    One file per CLI command (index, search, reset, eval, …)
  service/     HTTP server — Mission Control API and static file serving
  captains/    Captain task definitions, scheduler, and runner
  events/      Event bus (in-memory) and durable event log (events.jsonl)
  mcp/         MCP server — tools exposed to AI agents
  tui/         Ink TUI components — guided mode, onboarding, progress views
  indexing/    Indexing pipeline — LanceDB (default) and LocalJson providers
  memory/      Memory adapters (MemPalace, LocalJson)
  jobs/        Job runner — multi-step mission execution
  personas/    Persona loading and resolution
  execution/   Execution profiles
  llm/         LLM agent abstraction
  workspaces/  Workspace registry and config
  config/      Config loading (ctxhub.yaml)
  git/         Git utilities
  utils/       Shared helpers

ui/            React + Vite — Mission Control dashboard
  src/
    components/  UI components (CaptainsView, Timeline, ReviewView, …)
    api/         HTTP client (talks to src/service/)
    store/       Fleet state

docs/
  adr/         Architectural Decision Records — read before making arch changes
  strategy/    Vision, principles, roadmap, later phases
```

The CLI (`src/commands/`) and the service (`src/service/server.ts`) are the two main entry points. Most features touch one of: a command, an API route, a Captain/job scheduler, or an MCP tool.

---

## Setup

```bash
npm install
npm run build
npm test
```

For local development, run the CLI directly against source without building:

```bash
npm run ctxhub -- <command>
# or
npm run dev -- <command>
```

## Tests

Tests use Node's built-in test runner (`node:test`), not a separate framework — `npm test` runs everything under `src/**/*.test.ts` and `src/**/*.test.tsx` via `tsx`. Tests favor real behavior over mocks: git tests run against real temporary git repos, hook tests actually spawn shell commands, and the MCP server test drives a real in-memory client/server pair via `@modelcontextprotocol/sdk`.

When adding a command or module, add a colocated `*.test.ts` next to it. Modules take an explicit `cwd` parameter (defaulting to `process.cwd()`) specifically so tests can run against temp directories without mocking the filesystem.

Ink components under `src/tui/` are tested with `ink-testing-library` (`render` from that package, not `ink`'s own `render`), which fakes stdin/stdout so tests don't need a real TTY — see `src/tui/SearchApp.test.tsx` for the pattern (write simulated keystrokes to `stdin`, wait for the rendered frame you expect rather than sleeping a fixed amount, assert on `lastFrame()`). `GuidedApp.test.tsx`, `OnboardApp.test.tsx`, and the progress view tests follow the same pattern, with injectable dependencies/callbacks so tests can assert on the exact argv or command effects without spawning real subprocesses.

The guided menu itself is generated from the same `buildProgram()` Commander tree that powers the raw CLI (`src/tui/guided/commandTree.ts`'s `extractGuidedCommands`/`buildArgv`), so adding or changing a command in `src/cli/program.ts` automatically shows up there too — no separate registration needed. `commandTree.test.ts` runs its extraction against the real `buildProgram()` output as a regression guard (every top-level command must have a category, `mcp` stays excluded), so it'll fail loudly if a new command silently falls through uncategorized.

Note on testing interactive Ink apps against a *real* pty (e.g. via `expect`) rather than `ink-testing-library`: Ink treats a burst of multiple characters arriving in a single stdin read (with no escape byte) as potential pasted text, so a scripted tool that writes a whole string faster than the process can drain it (most `expect` `send` calls, without an intervening `expect`/flush) can merge a typed string with a following Enter into one non-key "paste-like" event instead of discrete keystrokes. This essentially never happens with real human typing speed; if you need to drive guided mode via a real pty for a manual check, force a read/flush between sends (e.g. `expect -timeout 1 timeout {}` after each `send`) or it'll look like Enter "does nothing."

`ctxhub onboard` is split into a testable orchestration function (`src/tui/onboardFlow.ts`) and a thin Ink bridge (`src/tui/OnboardApp.tsx`). Put branching/setup behavior in the orchestration layer where it can be covered with injected dependencies; keep the Ink component focused on prompt rendering and key handling.

Before opening a PR:

```bash
npm run build   # tsc must pass with no errors
npm test        # all tests must pass
npm run lint    # eslint must pass with no errors
```

CI (`.github/workflows/ci.yml`) runs the same three, plus `npm audit --audit-level=high` and, on PRs, commitlint against every commit in the PR range — all against a Node 22/24 matrix.

## Code style

- TypeScript strict mode. No `any` without a good reason. ESLint (`typescript-eslint`'s recommended rules, flat config in `eslint.config.js`) enforces the mechanical parts of this; `eslint-config-prettier` is included so adding a formatter later won't fight it, though none is wired up yet.
- No comments explaining *what* code does — names should make that obvious. Comments are for non-obvious *why* (a workaround, a subtle constraint, a decision that would otherwise look arbitrary).
- Don't add abstractions, config options, or error handling for cases that can't happen. Match the existing level of directness in a given file rather than generalizing ahead of need.
- Terminal output uses `chalk` (✓/✗/! prefixes) for durable output. Long-running commands use Ink progress views when stdout is a TTY and `ora` spinners as the non-TTY/plain fallback; keep that split when adding new progress-heavy commands.

## Adding a provider

The index and memory layers are both behind small interfaces so a new backend doesn't require touching CLI commands:

- Index providers implement `IndexProvider` (`src/indexing/IndexProvider.ts`); see `LocalJsonIndex.ts` for the simplest reference implementation and `LanceDbIndex.ts` for the default one. Register a new provider in `src/indexing/providers.ts`.
- Memory providers implement `MemoryAdapter` (`src/memory/MemoryAdapter.ts`); see `LocalJsonMemory.ts`, which also holds `MempalaceMemory` and the `createMemoryAdapter` factory.

See [ROADMAP.md](./ROADMAP.md) for what's already been decided against (and why) before proposing a new provider.

## Blueprints

A blueprint is a packaged set of personas, Captain task definitions, and mission templates for a specific stack or domain. They're the primary way the community extends ctxhub without touching core code.

To propose a new blueprint:

1. Open a [Blueprint Proposal](../../issues/new?template=blueprint_proposal.md) issue describing the target stack, what the Captain tasks cover, and any personas included.
2. Once agreed, add your files under `examples/blueprints/<name>/` following the structure in `examples/blueprints/README.md`.
3. Open a PR referencing the issue.

Blueprint contributions don't need to pass the full test suite (blueprints are YAML/markdown, not TypeScript), but the example workspace they target should index cleanly.

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): description`, e.g. `feat(agent): add copilot support` or `fix(hooks): don't fail sync when a hook errors`. A `commit-msg` git hook (via husky + commitlint) rejects non-conforming messages locally; the same check runs again in CI on pull requests.

Common types: `feat` (new capability), `fix` (bug fix), `docs`, `refactor`, `test`, `chore`, `ci`, `build`. Add a `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer for anything that breaks existing behavior.

Beyond the required `type:` prefix, still explain *why* in the body — the diff already shows what changed. If a change was a deliberate deviation from an obvious/simpler alternative, say so and why.

The hook installs automatically via `npm install` (the `prepare` script runs `husky`). If it's ever not active after cloning, run `npm install` again.

## Releases

Versioning and `CHANGELOG.md` are fully automated by [semantic-release](https://semantic-release.gitbook.io/), driven entirely by commit types since the last release — don't hand-edit `CHANGELOG.md` or bump `version` in `package.json` yourself. On every push to `main`, CI (`.github/workflows/release.yml`) determines the next version from the commits since the last release (`fix:` → patch, `feat:` → minor, a `BREAKING CHANGE:`/`!` → major), tags it, updates the changelog, and creates a GitHub release. Publishing to npm is currently disabled (`npmPublish: false` in `.releaserc.json`) until we're ready to ship publicly.

Note the local `v0.1.0` git tag: semantic-release has no support for starting below `1.0.0` — with zero prior tags, its very first automated release always jumps straight to `1.0.0`, regardless of commit types (this is documented, deliberate behavior, not configurable). Since this project isn't committing to a stable API yet, `v0.1.0` was seeded as a baseline before the first CI run, so releases compute forward from there (`0.1.0` → `0.2.0` for a `feat:`, → `0.1.1` for a `fix:`, etc.) instead of skipping straight to `1.0.0`. Crossing into `1.0.0` should be a deliberate choice (a `BREAKING CHANGE:`/`!` commit, or a manual tag), not an artifact of "this happened to be the first release."

## Pull requests

Keep PRs scoped to one change. If you're fixing a bug, a test that reproduces it belongs in the same PR. If you're adding a command, update `README.md`'s command list and, if it changes what's shipped vs. planned, `ROADMAP.md` too.
