# ctxhub CLI — Project Brief

`ctxhub` is a reusable, installable CLI for AI-assisted development workspaces. It manages multi-repo context, documentation indexing, and developer workflow automation, and exposes that context to AI agents both via the terminal and via an MCP server.

It is intentionally generic — nothing in the codebase is specific to any one project.

## Tech stack

- TypeScript (`strict` mode), Node.js 20+
- [Commander.js](https://github.com/tj/commander.js) for CLI commands
- YAML for project config
- [LanceDB](https://lancedb.github.io/lancedb/) as the default document index (local-first, embedded, with full-text search)
- [MemPalace](https://github.com) as the default durable agent-memory provider (external CLI/MCP tool)
- [`@modelcontextprotocol/sdk`](https://modelcontextprotocol.io/) for the MCP server
- [`smol-toml`](https://github.com/squirrelchat/smol-toml) for Codex's `.codex/config.toml` (pure JS, no native binary)
- A pluggable index provider interface and memory provider interface, so either can be swapped without touching CLI commands

## Package structure

```text
src/
  commands/    CLI command implementations (init, repo, index, sync, search, memory, doctor, mcp, agent, skills)
  config/      Config types, defaults, loading/saving, discovery
  git/         Safe git helpers (spawn-based, no shell interpolation)
  indexing/    Chunking, manifest tracking, and the index provider abstraction (LanceDB, local-json)
  mcp/         MCP server exposing read-only workspace tools to AI agents
  memory/      Memory provider abstraction (local-json, MemPalace)
  utils/       fs/hash/exec helpers, hook execution
  index.ts     CLI entrypoint (bin: ctxhub)
skills/        Static per-agent skill/prompt templates copied by `ctxhub skills install` (not compiled, shipped as-is)
```

Each module under `commands/`, `config/`, `git/`, `indexing/`, and `memory/` is plain, dependency-injected TypeScript (functions take an explicit `cwd`), so it's unit-testable without mocking the filesystem globally. See `*.test.ts` files alongside the modules they cover, run via `npm test` (Node's built-in test runner, no extra test framework dependency).

## Config

Project-level config is discovered from, in order:

1. `ctxhub.yaml`
2. `.ctxhub/config.yaml`

Example (see [ctxhub.example.yaml](./ctxhub.example.yaml)):

```yaml
version: 1
workspace:
  name: my-workspace
repositories:
  - name: app
    path: ./app
    include:
      - "README.md"
      - "docs/**/*.md"
      - "adr/**/*.md"
    exclude:
      - "node_modules/**"
      - ".git/**"
      - "dist/**"
memory:
  provider: mempalace
  path: .ctxhub/memory/mempalace
index:
  provider: lancedb
  path: .ctxhub/index/lancedb
  table: ctxhub_chunks
  incremental: true
  chunkSize: 1800
```

## Commands

| Command | Behavior |
| --- | --- |
| `ctxhub init` | Creates `.ctxhub/config.yaml`, `.ctxhub/index/`, `.ctxhub/cache/`, `.ctxhub/memory/`, and a default config. Refuses to overwrite an existing config unless `--force` is passed. |
| `ctxhub repo add <name> <path>` | Adds a repo entry to config; validates the path exists; detects whether it's a Git repo. |
| `ctxhub repo list` | Prints registered repos with their Git status. |
| `ctxhub repo discover [path]` | Finds Git repositories under the given path and adds any not already registered. |
| `ctxhub repo hook <name>` | Installs a real `.git/hooks/post-commit` script in that repo which backgrounds a `ctxhub index` run after each local commit (`--force` to overwrite an existing hook). Opt-in per repo. |
| `ctxhub index` | Reads all configured repos, applies include/exclude globs, chunks Markdown by heading, and indexes changed files (hash-based skip) into the configured index provider. Runs the `hooks.postIndex` command afterward if configured. |
| `ctxhub sync` | Pulls each Git repo (`--no-pull` to skip), runs `hooks.postPull` if configured, then re-indexes changed files, removes deleted ones, and runs `hooks.postIndex`. Prints a scanned/indexed/skipped/deleted summary. |
| `ctxhub search <query>` | Searches the index; returns ranked results with repo, path, heading, snippet, and commit. |
| `ctxhub memory status` | Shows memory provider status (e.g. MemPalace CLI availability) and index status (provider, chunk count, last indexed). |
| `ctxhub memory clear` | Clears the local index after confirmation (`--force` to skip). External MemPalace stores are left untouched — MemPalace manages its own memory lifecycle. |
| `ctxhub doctor` | Checks Node version, Git installed, config present, repo paths valid, index directory writable, and memory/index provider availability. |
| `ctxhub mcp` | Starts an MCP server (stdio transport) exposing `search`, `memory_status`, and `repo_list` as tools, so MCP-native agents (Claude Desktop, Cursor, etc.) can query the workspace index without shelling out to the CLI. |
| `ctxhub agent <name>` | Writes/merges the MCP config for `claude`, `codex`, or `copilot` registering the `ctxhub` MCP server, then launches the named agent in the current directory. `--no-launch` writes the config only. |
| `ctxhub skills install [agents...]` | Installs a ctxhub usage skill/prompt file for `claude`, `codex`, `copilot`, and/or `cursor` (default: all four) — chat-native guidance to check the index before answering questions about the codebase. |

## Architecture: index vs. memory

The brief originally called for a single generic "memory provider" abstraction. In practice the implementation splits this into two concerns, documented here because it's a deliberate deviation from a literal reading of the original ask:

- **Index** (`src/indexing/`) — the project's own searchable document/source index. Default provider is **LanceDB** (embedded, local, with full-text search via Lance's FTS index and a lexical-search fallback). A `local-json` provider remains as a lightweight fallback/example implementation.
- **Memory** (`src/memory/`) — durable, cross-session *agent* memory (decisions, session history). Default provider is **MemPalace**, an external CLI/MCP tool; ctxhub's `MempalaceMemory` adapter deliberately throws on writes/search, directing callers to MemPalace's own tools, so ctxhub doesn't become a second source of truth for agent memory. A `local-json` memory provider is kept for simple/offline use.

Both providers implement the same shape of interface (`src/memory/MemoryAdapter.ts`, `src/indexing/IndexProvider.ts`), so a new provider (e.g. an embeddings/vector-DB index, or a different memory backend) can be added without touching CLI commands.

## Indexing

- Markdown is chunked by heading (`#`–`######`), preserving frontmatter and falling back to paragraph-based chunking for headless/plain text.
- Chunks are stored with metadata: workspace, repo, path, hash, commit, title/heading, lastIndexed.
- A manifest (`.ctxhub/memory/manifest.json`) tracks per-file hashes so `ctxhub index`/`ctxhub sync` only re-index changed files and remove deleted ones.
- LanceDB search uses its native full-text index when available, falling back to lexical scoring for small or partially-indexed tables — keeping the door open for embeddings/vector search later without changing the `IndexProvider` interface.

## Hooks

Two mechanisms keep the index current without manual `ctxhub index` runs:

- **Config-level lifecycle hooks** (`src/utils/hooks.ts`) — `hooks.postPull`/`hooks.postIndex` in config are arbitrary shell commands, run with `CTXHUB_EVENT`/`CTXHUB_WORKSPACE` env vars via `child_process.spawn({ shell: true, stdio: 'inherit' })`. Wired into `ctxhub sync` (postPull after pulling, postIndex after re-indexing) and `ctxhub index` (postIndex). A failing hook warns rather than failing the command.
- **Git `post-commit` hook** (`ctxhub repo hook <name>`, in `src/commands/repo.ts`) — writes an executable `.git/hooks/post-commit` script into the target repo that backgrounds `ctxhub index` (via an absolute path to the running CLI entrypoint) after every commit. Explicit opt-in per repo, refuses to clobber an existing hook without `--force`.

## Agent launch integration

`ctxhub agent <claude|codex|copilot>` (`src/commands/agent.ts`) writes/merges that agent's MCP config to register the `ctxhub` MCP server, then launches the agent with `stdio: 'inherit'` so it runs interactively in the current terminal. `--no-launch` writes the config without launching. All writers preserve any other keys/servers already present and skip the write entirely if the `ctxhub` entry is already correct (`AgentConfigResult.changed`).

- **`claude`** merges `{ mcpServers: { ctxhub: { command: 'ctxhub', args: ['mcp'] } } }` into `.mcp.json` (JSON, project-scoped, via `JSON.parse`/`JSON.stringify`).
- **`codex`** merges `[mcp_servers.ctxhub]` into `.codex/config.toml` (TOML, project-scoped, via the `smol-toml` package — pure JS, no native binary, chosen after the `@lancedb/lancedb` install-fragility episode). Verified against OpenAI's own docs before building: Codex only loads project-scoped `.codex/config.toml` for projects it *trusts* (untrusted projects skip it entirely — there's an open upstream issue, [openai/codex#13025](https://github.com/openai/codex/issues/13025), about this not always working even when expected), and the built-in `codex mcp add` subcommand only writes the user-level `~/.codex/config.toml`, not project scope — hence `ctxhub agent codex` filling that gap. It prints a reminder about the trust requirement after writing, since ctxhub can't grant that trust itself.
- **`copilot`** merges `{ mcpServers: { ctxhub: { type: 'local', command: 'ctxhub', args: ['mcp'], tools: ['*'] } } }` into `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`). Verified via GitHub's own docs before building: this is **user-level only** — a community blog claimed a repo-level `.copilot/mcp-config.json`, but GitHub's official docs don't confirm any project-scoped file for the Copilot CLI (the only other Copilot surfaces are the unrelated VS Code extension's `.vscode/mcp.json` with a `"servers"` key, and the GitHub.com cloud coding agent's web-UI-only config — neither fits a CLI launch flow), so the write deliberately targets the one place that's actually documented, and prints a note about the scope difference.

Neither JSON nor TOML writer preserves comments/formatting on rewrite — the same tradeoff already accepted for `ctxhub.yaml` via `js-yaml`.

## Installable skills

`ctxhub skills install [agents...]` (`src/commands/skills.ts`) copies a static "how to use ctxhub in this workspace" skill/prompt file per agent, complementing the MCP server: MCP grants tool access, the skill nudges *when* to use it (and documents the plain CLI as a fallback for agents without the MCP server wired up). Defaults to all four supported agents when none are named; validates all requested agent names before writing anything.

The template content itself lives as plain files under [`skills/`](./skills/) at the repo root, not as string literals in code — so they render as real Markdown on GitHub, are directly diffable/editable, and can be copied in by hand without running the CLI at all. `skills.ts` resolves its own package root via `import.meta.url` (works identically whether running from `src/` under `tsx` or from the compiled `dist/`) and just reads-then-writes each template verbatim; `package.json`'s `files` array ships the `skills/` directory with the published npm package.

Researched each agent's actual convention rather than assuming one shared format:

- **`claude`**: `skills/claude/SKILL.md` → `.claude/skills/ctxhub/SKILL.md` — frontmatter `name`/`description` (both required; `name` must match the folder name).
- **`codex`**: `skills/codex/SKILL.md` → `.agents/skills/ctxhub/SKILL.md` — byte-identical to Claude's template (same frontmatter shape). Codex deprecated its old `~/.codex/prompts/*.md` custom-prompts mechanism in favor of this SKILL.md convention.
- **`copilot`**: `skills/copilot/ctxhub.prompt.md` → `.github/prompts/ctxhub.prompt.md` — frontmatter has `description` only (no `name`; the filename is the identifier).
- **`cursor`**: `skills/cursor/ctxhub.md` → `.cursor/commands/ctxhub.md` — plain Markdown, no frontmatter at all.

Unlike the MCP config writers above, each target here is a dedicated file namespaced by the skill name (`ctxhub`), not a shared config file with other entries to preserve — so there's no merge logic, just a plain overwrite on each install.

## Git utilities

`src/git/git.ts` implements `isGitRepo`, `getCurrentCommit`, `pullRepo`, `getRepoName`, and `isGitInstalled`, all via `src/utils/execa-lite.ts` — a small `child_process.spawn` wrapper with `shell: false` and argument arrays throughout, so repo paths/names can never reach a shell.

## UX

Terminal output uses `chalk` for ticks/crosses/warnings and `ora` spinners for long-running steps (index, sync), with concise, actionable summaries (e.g. `scanned / indexed / skipped / deleted`) rather than raw logs.

## Quality

- TypeScript strict mode; `npm run build` type-checks with `tsc` and excludes `*.test.ts` from the published `dist/`.
- `npm test` runs the Node test suite (config loading/merging, git helpers against real temp repos, Markdown chunking, the manifest, `LocalJsonMemory`, the MCP server via an in-memory client/transport pair, hook execution, the `repo hook` git-hook installer, the `.mcp.json`/`.codex/config.toml`/`~/.copilot/mcp-config.json` merge logic for `ctxhub agent`, and the per-agent file output of `ctxhub skills install`).
- Errors are actionable (e.g. "No ctxhub config found... Run: ctxhub init") rather than raw stack traces.

## Extension points

Status of the extension points named in the original brief:

- [x] MCP server integration — `ctxhub mcp`, see above.
- [x] Post-pull/post-commit hooks — `hooks.postPull`/`hooks.postIndex` config, plus `ctxhub repo hook <name>` for a real Git `post-commit` hook.
- [x] Claude launch integration — `ctxhub agent claude`.
- [x] Codex launch integration — `ctxhub agent codex`, see above.
- [x] Copilot launch integration — `ctxhub agent copilot`, see above (not in the original brief, added after discussion).
- [x] Installable skills for coding agents (`ctxhub skills install`) — not in the original brief, added after discussion.
- [ ] AI-generated documentation validation.

Not planned: a MemPalace provider for CLI *write* operations, or an embeddings/vector-DB index provider. Both were deliberately decided against rather than merely deferred — see "Architecture: index vs. memory" and the note under "Agent launch integration" above.

## Acceptance criteria

All satisfied:

- `npm install`, `npm run build`, `npm run ctxhub -- init` work.
- Repos can be added (`repo add`) and discovered (`repo discover`).
- Docs can be indexed (`index`), searched (`search`), and kept in sync (`sync`).
- Memory/index status and clearing work (`memory status`, `memory clear`).
- The CLI installs/links locally via `npm link` and runs as `ctxhub`.
- AI agents can query the workspace over MCP via `ctxhub mcp`.
