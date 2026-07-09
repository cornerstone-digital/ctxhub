# Contributing

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

Tests use Node's built-in test runner (`node:test`), not a separate framework — `npm test` runs everything under `src/**/*.test.ts` via `tsx`. Tests favor real behavior over mocks: git tests run against real temporary git repos, hook tests actually spawn shell commands, and the MCP server test drives a real in-memory client/server pair via `@modelcontextprotocol/sdk`.

When adding a command or module, add a colocated `*.test.ts` next to it. Modules take an explicit `cwd` parameter (defaulting to `process.cwd()`) specifically so tests can run against temp directories without mocking the filesystem.

Before opening a PR:

```bash
npm run build   # tsc must pass with no errors
npm test        # all tests must pass
```

## Code style

- TypeScript strict mode. No `any` without a good reason.
- No comments explaining *what* code does — names should make that obvious. Comments are for non-obvious *why* (a workaround, a subtle constraint, a decision that would otherwise look arbitrary).
- Don't add abstractions, config options, or error handling for cases that can't happen. Match the existing level of directness in a given file rather than generalizing ahead of need.
- Terminal output uses `chalk` (✓/✗/! prefixes) and `ora` spinners for long-running steps — match the existing style rather than introducing a new output convention.

## Adding a provider

The index and memory layers are both behind small interfaces so a new backend doesn't require touching CLI commands:

- Index providers implement `IndexProvider` (`src/indexing/IndexProvider.ts`); see `LocalJsonIndex.ts` for the simplest reference implementation and `LanceDbIndex.ts` for the default one. Register a new provider in `src/indexing/providers.ts`.
- Memory providers implement `MemoryAdapter` (`src/memory/MemoryAdapter.ts`); see `LocalJsonMemory.ts`, which also holds `MempalaceMemory` and the `createMemoryAdapter` factory.

See [ROADMAP.md](./ROADMAP.md) for what's already been decided against (and why) before proposing a new provider.

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): description`, e.g. `feat(agent): add copilot support` or `fix(hooks): don't fail sync when a hook errors`. A `commit-msg` git hook (via husky + commitlint) rejects non-conforming messages locally; the same check runs again in CI on pull requests.

Common types: `feat` (new capability), `fix` (bug fix), `docs`, `refactor`, `test`, `chore`, `ci`, `build`. Add a `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer for anything that breaks existing behavior.

Beyond the required `type:` prefix, still explain *why* in the body — the diff already shows what changed. If a change was a deliberate deviation from an obvious/simpler alternative, say so and why.

The hook installs automatically via `npm install` (the `prepare` script runs `husky`). If it's ever not active after cloning, run `npm install` again.

## Releases

Versioning and `CHANGELOG.md` are fully automated by [semantic-release](https://semantic-release.gitbook.io/), driven entirely by commit types since the last release — don't hand-edit `CHANGELOG.md` or bump `version` in `package.json` yourself. On every push to `main`, CI (`.github/workflows/release.yml`) determines the next version from the commits since the last release (`fix:` → patch, `feat:` → minor, a `BREAKING CHANGE:`/`!` → major), tags it, updates the changelog, and creates a GitHub release. Publishing to npm is currently disabled (`npmPublish: false` in `.releaserc.json`) until we're ready to ship publicly.

## Pull requests

Keep PRs scoped to one change. If you're fixing a bug, a test that reproduces it belongs in the same PR. If you're adding a command, update `README.md`'s command list and, if it changes what's shipped vs. planned, `ROADMAP.md` too.
