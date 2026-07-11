# Contributing

Contributions are welcome — code, tests, documentation, blueprints, and bug reports all count. No contribution is too small.

---

## Getting started (under 5 minutes)

```bash
git clone https://github.com/ctxhub/ctxhub
cd ctxhub
npm install
npm run build
npm test          # should be green
npm link          # makes `ctxhub` available globally
ctxhub --version  # verify
```

For local development without rebuilding on every change:

```bash
npm run ctxhub -- <command>
# or
npm run dev -- <command>
```

---

## Architecture orientation

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
  blueprints/  Blueprint manifest types and install store

ui/            React + Vite — Mission Control dashboard
  src/
    components/  UI components (CaptainsView, Timeline, ReviewView, …)
    api/         HTTP client (talks to src/service/)
    store/       Fleet state

docs/
  adr/         Architectural Decision Records — read before making arch changes
  strategy/    Vision, principles, roadmap, later phases
  security/    Data boundary, residency, and responsible disclosure
```

**Key files to read first:**

- `src/cli/program.ts` — command wiring; all subcommands are registered here
- `src/service/server.ts` — HTTP server; all API routes are defined here
- `src/indexing/indexer.ts` — core indexing pipeline; where files become chunks
- `src/mcp/server.ts` — MCP protocol server; tools exposed to AI agents

The CLI (`src/commands/`) and the service (`src/service/server.ts`) are the two main entry points. Most features touch one of: a command, an API route, a Captain/job scheduler, or an MCP tool.

---

## How to find good first issues

Browse issues labelled [`good first issue`](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22) on GitHub. Each one has:

- A clear description of the problem
- A definition of done
- Pointers to the relevant source files

If you want to work on something, leave a comment so we do not duplicate effort. If you are unsure where to start, comment on the issue and ask — it is faster than guessing.

Not sure what to work on? The most useful contributions right now are:

- Bug reports with a reproduction — a failing test case is even better
- Documentation improvements — anywhere the README or quickstart confused you is a valid target
- New Captain task definitions — share a `.yaml` that works well for your stack
- Blueprint proposals — a packaged set of personas and captain tasks for a specific framework or domain

Read [ROADMAP.md](./ROADMAP.md) before proposing a large feature. The "What we are not optimising for" section explains the boundaries. Some things are deliberately not planned; re-litigating a settled tradeoff without new information is not a good use of anyone's time.

---

## Development workflow

Branch from `main`, name your branch `feat/short-description` or `fix/short-description`.

```bash
git checkout -b feat/my-thing
```

Before opening a PR:

```bash
npm test          # all tests must pass
npx tsc --noEmit  # types must be clean
npm run lint      # eslint must pass with no errors
```

Keep PRs focused: one logical change per PR. If you are fixing a bug, a test that reproduces it belongs in the same PR. If you are adding a command, update `README.md`'s command list.

---

## Review SLA

No open PR sits unreviewed for more than 7 days. If yours has been open longer, ping in the PR comments.

---

## Testing conventions

Tests live next to source: `foo.ts` → `foo.test.ts`.

Tests use Node's built-in test runner (`node:test`), not a separate framework:

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('myModule', () => {
  test('does what it should', async () => {
    const result = await myFunction();
    assert.equal(result, 'expected');
  });
});
```

`npm test` runs everything under `src/**/*.test.ts` and `src/**/*.test.tsx` via `tsx`.

Tests favour real behaviour over mocks: git tests run against real temporary git repos, hook tests actually spawn shell commands, and the MCP server test drives a real in-memory client/server pair. Modules take an explicit `cwd` parameter (defaulting to `process.cwd()`) specifically so tests can run against temp directories without mocking the filesystem.

Ink components under `src/tui/` are tested with `ink-testing-library` — see `src/tui/SearchApp.test.tsx` for the pattern.

New features need tests. Bug fixes should add a regression test.

---

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(agent): add copilot support
fix(hooks): don't fail sync when a hook errors
docs(readme): clarify install steps
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`. Add a `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer for anything that breaks existing behaviour.

A `commit-msg` git hook (via husky + commitlint) rejects non-conforming messages locally; the same check runs in CI on pull requests.

Beyond the required type prefix, explain *why* in the body — the diff already shows what changed.

---

## Code style

- TypeScript strict mode. No `any` without a good reason.
- ESLint (`typescript-eslint` recommended rules, flat config in `eslint.config.js`) enforces the mechanical parts.
- No comments explaining *what* code does — names should make that obvious. Comments are for non-obvious *why* (a workaround, a subtle constraint, a decision that would otherwise look arbitrary).
- Terminal output uses `chalk` (✓/✗/! prefixes) for durable output. Long-running commands use Ink progress views when stdout is a TTY and `ora` spinners as the non-TTY fallback.
- Don't add abstractions, config options, or error handling for cases that cannot happen. Match the existing level of directness in a given file.

---

## Adding a provider

The index and memory layers are both behind small interfaces:

- Index providers implement `IndexProvider` (`src/indexing/IndexProvider.ts`). See `LocalJsonIndex.ts` for the simplest reference implementation. Register a new provider in `src/indexing/providers.ts`.
- Memory providers implement `MemoryAdapter` (`src/memory/MemoryAdapter.ts`). See `LocalJsonMemory.ts`.

---

## Blueprints

A blueprint is a packaged set of personas, Captain task definitions, and mission templates for a specific stack or domain. They are the primary way the community extends ctxhub without touching core code.

To propose a new blueprint:

1. Open a [Blueprint Proposal](../../issues/new?template=blueprint_proposal.md) issue describing the target stack, what the Captain tasks cover, and any personas included.
2. Once agreed, add your files under `examples/blueprints/<name>/` following the structure in `examples/blueprints/README.md`.
3. Open a PR referencing the issue.

To pack and install a blueprint locally:

```bash
ctxhub blueprint pack --dir ./my-blueprint
ctxhub blueprint install ./my-blueprint-1.0.0.ctxblueprint
ctxhub blueprint list
```

Blueprint contributions don't need to pass the full test suite (blueprints are YAML/markdown, not TypeScript), but the example workspace they target should index cleanly.

---

## Release process

Versioning and `CHANGELOG.md` are fully automated by [semantic-release](https://semantic-release.gitbook.io/), driven by commit types since the last release:

- `fix:` → patch
- `feat:` → minor
- `BREAKING CHANGE:` / `!` → major

Don't hand-edit `CHANGELOG.md` or bump `version` in `package.json` yourself. On every push to `main`, CI determines the next version, tags it, updates the changelog, and creates a GitHub release.

If you need to cut a manual release:

```bash
git tag v0.5.1 && git push --tags
```

---

## Pull requests

- Keep PRs scoped to one change
- If you are fixing a bug, include the regression test in the same PR
- If you are adding a command, update `README.md`'s command list and, if it changes what's shipped vs. planned, `ROADMAP.md` too
- CI runs `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm audit --audit-level=high` against Node 22 and 24
