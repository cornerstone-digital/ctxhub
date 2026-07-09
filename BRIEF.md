# SSD CLI — Project Brief

`ssd` is a reusable, installable CLI for AI-assisted development workspaces. It manages multi-repo context, documentation indexing, and developer workflow automation, and exposes that context to AI agents both via the terminal and via an MCP server.

It is intentionally generic — nothing in the codebase is specific to any one project.

## Tech stack

- TypeScript (`strict` mode), Node.js 20+
- [Commander.js](https://github.com/tj/commander.js) for CLI commands
- YAML for project config
- [LanceDB](https://lancedb.github.io/lancedb/) as the default document index (local-first, embedded, with full-text search)
- [MemPalace](https://github.com) as the default durable agent-memory provider (external CLI/MCP tool)
- [`@modelcontextprotocol/sdk`](https://modelcontextprotocol.io/) for the MCP server
- A pluggable index provider interface and memory provider interface, so either can be swapped without touching CLI commands

## Package structure

```text
src/
  commands/    CLI command implementations (init, repo, index, sync, search, memory, doctor, mcp)
  config/      Config types, defaults, loading/saving, discovery
  git/         Safe git helpers (spawn-based, no shell interpolation)
  indexing/    Chunking, manifest tracking, and the index provider abstraction (LanceDB, local-json)
  mcp/         MCP server exposing read-only workspace tools to AI agents
  memory/      Memory provider abstraction (local-json, MemPalace)
  utils/       fs/hash/exec helpers
  index.ts     CLI entrypoint (bin: ssd)
```

Each module under `commands/`, `config/`, `git/`, `indexing/`, and `memory/` is plain, dependency-injected TypeScript (functions take an explicit `cwd`), so it's unit-testable without mocking the filesystem globally. See `*.test.ts` files alongside the modules they cover, run via `npm test` (Node's built-in test runner, no extra test framework dependency).

## Config

Project-level config is discovered from, in order:

1. `ssd.yaml`
2. `.ssd/config.yaml`

Example (see [ssd.example.yaml](./ssd.example.yaml)):

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
  path: .ssd/memory/mempalace
index:
  provider: lancedb
  path: .ssd/index/lancedb
  table: ssd_chunks
  incremental: true
  chunkSize: 1800
```

## Commands

| Command | Behavior |
| --- | --- |
| `ssd init` | Creates `.ssd/config.yaml`, `.ssd/index/`, `.ssd/cache/`, `.ssd/memory/`, and a default config. Refuses to overwrite an existing config unless `--force` is passed. |
| `ssd repo add <name> <path>` | Adds a repo entry to config; validates the path exists; detects whether it's a Git repo. |
| `ssd repo list` | Prints registered repos with their Git status. |
| `ssd repo discover [path]` | Finds Git repositories under the given path and adds any not already registered. |
| `ssd repo hook <name>` | Installs a real `.git/hooks/post-commit` script in that repo which backgrounds a `ssd index` run after each local commit (`--force` to overwrite an existing hook). Opt-in per repo. |
| `ssd index` | Reads all configured repos, applies include/exclude globs, chunks Markdown by heading, and indexes changed files (hash-based skip) into the configured index provider. Runs the `hooks.postIndex` command afterward if configured. |
| `ssd sync` | Pulls each Git repo (`--no-pull` to skip), runs `hooks.postPull` if configured, then re-indexes changed files, removes deleted ones, and runs `hooks.postIndex`. Prints a scanned/indexed/skipped/deleted summary. |
| `ssd search <query>` | Searches the index; returns ranked results with repo, path, heading, snippet, and commit. |
| `ssd memory status` | Shows memory provider status (e.g. MemPalace CLI availability) and index status (provider, chunk count, last indexed). |
| `ssd memory clear` | Clears the local index after confirmation (`--force` to skip). External MemPalace stores are left untouched — MemPalace manages its own memory lifecycle. |
| `ssd doctor` | Checks Node version, Git installed, config present, repo paths valid, index directory writable, and memory/index provider availability. |
| `ssd mcp` | Starts an MCP server (stdio transport) exposing `search`, `memory_status`, and `repo_list` as tools, so MCP-native agents (Claude Desktop, Cursor, etc.) can query the workspace index without shelling out to the CLI. |
| `ssd agent <name>` | Writes/merges `.mcp.json` in the workspace root registering the `ssd` MCP server, then launches the named agent (`claude`) in the current directory. `--no-launch` writes the config only. |

## Architecture: index vs. memory

The brief originally called for a single generic "memory provider" abstraction. In practice the implementation splits this into two concerns, documented here because it's a deliberate deviation from a literal reading of the original ask:

- **Index** (`src/indexing/`) — the project's own searchable document/source index. Default provider is **LanceDB** (embedded, local, with full-text search via Lance's FTS index and a lexical-search fallback). A `local-json` provider remains as a lightweight fallback/example implementation.
- **Memory** (`src/memory/`) — durable, cross-session *agent* memory (decisions, session history). Default provider is **MemPalace**, an external CLI/MCP tool; SSD's `MempalaceMemory` adapter deliberately throws on writes/search, directing callers to MemPalace's own tools, so SSD doesn't become a second source of truth for agent memory. A `local-json` memory provider is kept for simple/offline use.

Both providers implement the same shape of interface (`src/memory/MemoryAdapter.ts`, `src/indexing/IndexProvider.ts`), so a new provider (e.g. an embeddings/vector-DB index, or a different memory backend) can be added without touching CLI commands.

## Indexing

- Markdown is chunked by heading (`#`–`######`), preserving frontmatter and falling back to paragraph-based chunking for headless/plain text.
- Chunks are stored with metadata: workspace, repo, path, hash, commit, title/heading, lastIndexed.
- A manifest (`.ssd/memory/manifest.json`) tracks per-file hashes so `ssd index`/`ssd sync` only re-index changed files and remove deleted ones.
- LanceDB search uses its native full-text index when available, falling back to lexical scoring for small or partially-indexed tables — keeping the door open for embeddings/vector search later without changing the `IndexProvider` interface.

## Hooks

Two mechanisms keep the index current without manual `ssd index` runs:

- **Config-level lifecycle hooks** (`src/utils/hooks.ts`) — `hooks.postPull`/`hooks.postIndex` in config are arbitrary shell commands, run with `SSD_EVENT`/`SSD_WORKSPACE` env vars via `child_process.spawn({ shell: true, stdio: 'inherit' })`. Wired into `ssd sync` (postPull after pulling, postIndex after re-indexing) and `ssd index` (postIndex). A failing hook warns rather than failing the command.
- **Git `post-commit` hook** (`ssd repo hook <name>`, in `src/commands/repo.ts`) — writes an executable `.git/hooks/post-commit` script into the target repo that backgrounds `ssd index` (via an absolute path to the running CLI entrypoint) after every commit. Explicit opt-in per repo, refuses to clobber an existing hook without `--force`.

## Agent launch integration

`ssd agent claude` (`src/commands/agent.ts`) writes/merges a `.mcp.json` in the workspace root — preserving any other keys or MCP servers already present, and skipping the write entirely if the `ssd` entry is already correct — then spawns `claude` with `stdio: 'inherit'` so it launches interactively in the current terminal. `--no-launch` writes the config without launching.

Only `claude` is currently supported (`SUPPORTED_AGENTS`). Codex was intentionally left out: its MCP config lives in `~/.codex/config.toml` rather than a per-project file, which is a different integration shape than the `.mcp.json` merge above, and it wasn't worth guessing at the exact format without verifying it first.

## Git utilities

`src/git/git.ts` implements `isGitRepo`, `getCurrentCommit`, `pullRepo`, `getRepoName`, and `isGitInstalled`, all via `src/utils/execa-lite.ts` — a small `child_process.spawn` wrapper with `shell: false` and argument arrays throughout, so repo paths/names can never reach a shell.

## UX

Terminal output uses `chalk` for ticks/crosses/warnings and `ora` spinners for long-running steps (index, sync), with concise, actionable summaries (e.g. `scanned / indexed / skipped / deleted`) rather than raw logs.

## Quality

- TypeScript strict mode; `npm run build` type-checks with `tsc` and excludes `*.test.ts` from the published `dist/`.
- `npm test` runs the Node test suite (config loading/merging, git helpers against real temp repos, Markdown chunking, the manifest, `LocalJsonMemory`, the MCP server via an in-memory client/transport pair, hook execution, the `repo hook` git-hook installer, and the `.mcp.json` merge logic for `ssd agent`).
- Errors are actionable (e.g. "No SSD config found... Run: ssd init") rather than raw stack traces.

## Extension points

Status of the extension points named in the original brief:

- [x] MCP server integration — `ssd mcp`, see above.
- [x] Post-pull/post-commit hooks — `hooks.postPull`/`hooks.postIndex` config, plus `ssd repo hook <name>` for a real Git `post-commit` hook.
- [x] Claude launch integration — `ssd agent claude`; Codex intentionally deferred (see above).
- [ ] Codex launch integration — needs its actual MCP config format (`~/.codex/config.toml`) verified first.
- [ ] AI-generated documentation validation.

Not planned: a MemPalace provider for CLI *write* operations, or an embeddings/vector-DB index provider. Both were deliberately decided against rather than merely deferred — see "Architecture: index vs. memory" and the note under "Agent launch integration" above.

## Acceptance criteria

All satisfied:

- `npm install`, `npm run build`, `npm run ssd -- init` work.
- Repos can be added (`repo add`) and discovered (`repo discover`).
- Docs can be indexed (`index`), searched (`search`), and kept in sync (`sync`).
- Memory/index status and clearing work (`memory status`, `memory clear`).
- The CLI installs/links locally via `npm link` and runs as `ssd`.
- AI agents can query the workspace over MCP via `ssd mcp`.
