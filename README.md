# devctx CLI

`devctx` is a reusable CLI for AI-assisted development workspaces. It manages multi-repo context, indexes local documentation and source files in LanceDB, and leaves durable agent memory to MemPalace by default.

## Prerequisites

- Node.js 20+
- Git (only required if you want repo detection/`devctx sync` to do anything — devctx itself works without it)
- Optional: [MemPalace](https://github.com) CLI, if you use the default `memory.provider: mempalace`. Install with `uv tool install mempalace` (requires [uv](https://docs.astral.sh/uv/)). Without it, `devctx memory status`/`devctx doctor` will report it as unavailable but the rest of the CLI (indexing, search) still works — or set `memory.provider: local-json` in config to avoid the dependency entirely.
- Optional: an MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.), only needed if you use `devctx mcp`.

## Install

```bash
npm install
npm run build
npm link
```

For local development:

```bash
npm run devctx -- --help
```

## Quick Start

```bash
devctx init --name my-workspace
devctx repo add app ./app
devctx repo discover ../
devctx repo list
devctx index
devctx search "authentication flow"
devctx sync
devctx memory status
devctx doctor
devctx mcp
devctx agent claude
devctx skills install
```

`devctx init` creates:

- `.devctx/config.yaml`
- `.devctx/index/`
- `.devctx/cache/`
- `.devctx/memory/`

Config is discovered from `devctx.yaml` first, then `.devctx/config.yaml`.

By default, `devctx search` uses the LanceDB-backed project index. MemPalace is configured separately as the durable agent memory layer so Claude/Codex/MCP clients can recall project decisions and session history without mixing that data into the source/document index.

## Config

See [devctx.example.yaml](./devctx.example.yaml).

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
  path: .devctx/memory/mempalace
index:
  provider: lancedb
  path: .devctx/index/lancedb
  table: devctx_chunks
  incremental: true
  chunkSize: 1800
hooks:
  postPull: "npm --prefix ./app install"
  postIndex: "echo indexed workspace $DEVCTX_WORKSPACE"
```

## Commands

- `devctx init`: create workspace config and local devctx directories.
- `devctx repo add <name> <path>`: add a repo, validate the path, and detect Git.
- `devctx repo list`: print configured repos.
- `devctx repo discover [path]`: find Git repositories below a folder and add them.
- `devctx repo hook <name>`: install a `post-commit` Git hook in that repo which re-indexes the workspace in the background after each commit (`-f/--force` to overwrite an existing hook).
- `devctx index`: index changed workspace files.
- `devctx sync`: pull configured repos and re-index changed files.
- `devctx search <query>`: search the LanceDB project index.
- `devctx memory status`: show MemPalace memory status and LanceDB index status.
- `devctx memory clear`: clear the devctx index after confirmation; external MemPalace stores are left to MemPalace.
- `devctx doctor`: check Node, Git, config, repo paths, index directory, and memory provider.
- `devctx mcp`: start an MCP server (stdio) exposing `search`, `memory_status`, and `repo_list` as tools for AI agents.
- `devctx agent <name>`: write/merge the MCP config for `claude` (`.mcp.json`), `codex` (`.codex/config.toml`), or `copilot` (`~/.copilot/mcp-config.json`) and launch it (`--no-launch` to only write the config).
- `devctx skills install [agents...]`: install a chat-native "how to use devctx" skill/prompt for `claude`, `codex`, `copilot`, and/or `cursor` (default: all four).

## MCP server

`devctx mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, so MCP-native clients (Claude Desktop, Claude Code, Cursor, etc.) can query the workspace index as structured tools instead of shelling out and parsing terminal output.

Tools exposed:

- `search(query, limit?)` — same ranked results as `devctx search`.
- `memory_status()` — same output as `devctx memory status`.
- `repo_list()` — same output as `devctx repo list`.

These are intentionally read-only. Mutating operations (`index`, `sync`, `memory clear`) stay CLI/human-driven rather than agent-callable, so an agent can look things up but can't rebuild or clear the index on its own.

Example client config (e.g. `claude_desktop_config.json` or a project's `.mcp.json`):

```json
{
  "mcpServers": {
    "devctx": {
      "command": "devctx",
      "args": ["mcp"],
      "cwd": "/path/to/your/workspace"
    }
  }
}
```

## Launching an agent

`devctx agent <claude|codex|copilot>` writes (or merges into) that agent's MCP config to register the `devctx` MCP server, then launches the agent in the current directory so it picks the server up immediately. Pass `--no-launch` to only write the config without starting the agent — useful in CI, or if you'd rather launch it yourself.

**Claude** — merges into `.mcp.json` (project-scoped):

```json
{
  "mcpServers": {
    "devctx": { "command": "devctx", "args": ["mcp"] }
  }
}
```

**Codex** — merges into `.codex/config.toml` (project-scoped):

```toml
[mcp_servers.devctx]
command = "devctx"
args = ["mcp"]
```

Codex only loads project-scoped `.codex/config.toml` for projects it trusts (untrusted projects skip it entirely — see [openai/codex#13025](https://github.com/openai/codex/issues/13025)); `devctx agent codex` prints a reminder of this after writing the config, since there's no way for devctx to grant that trust on Codex's behalf.

**Copilot** (the `copilot` CLI) — merges into `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`):

```json
{
  "mcpServers": {
    "devctx": { "type": "local", "command": "devctx", "args": ["mcp"], "tools": ["*"] }
  }
}
```

This one is **user-level, not project-scoped** — GitHub doesn't document a supported project-scoped file for the Copilot CLI (only the unrelated VS Code extension's `.vscode/mcp.json`, and the GitHub.com cloud coding agent's web-UI-only config). It still works per-project in practice, since the `devctx` server always uses whichever directory `copilot` is launched from. `devctx agent copilot` prints a note about this scope difference.

All merges preserve any other keys or servers already in the file and are idempotent — running the command again when nothing needs to change is a no-op, and TOML/JSON values round-trip correctly, though comments and formatting in a hand-edited file are not preserved on rewrite (the same tradeoff this project already accepts for its own `devctx.yaml` via `js-yaml`).

## Installable skills

`devctx skills install [agents...]` copies a small "how to use devctx in this workspace" skill/prompt file into one or more coding agents' own conventions, so the agent knows to check the index *before* answering questions about this codebase — this complements the MCP server (which grants tool access) with usage guidance (which nudges *when* to use it), and still helps agents that don't have the MCP server wired up, since it also documents the plain CLI commands. Run with no arguments to install for all four; name specific agents (e.g. `devctx skills install claude cursor`) to limit it.

The templates themselves live in this repo under [`skills/`](./skills/) and are plain, static files — copy them in by hand instead of running the command if you'd rather not install the CLI at all:

| Agent | Template | Installs to |
| --- | --- | --- |
| `claude` | [`skills/claude/SKILL.md`](./skills/claude/SKILL.md) | `.claude/skills/devctx/SKILL.md` |
| `codex` | [`skills/codex/SKILL.md`](./skills/codex/SKILL.md) | `.agents/skills/devctx/SKILL.md` (identical content to Claude's — Codex's skills format is compatible) |
| `copilot` | [`skills/copilot/devctx.prompt.md`](./skills/copilot/devctx.prompt.md) | `.github/prompts/devctx.prompt.md` |
| `cursor` | [`skills/cursor/devctx.md`](./skills/cursor/devctx.md) | `.cursor/commands/devctx.md` |

Each destination is a dedicated file devctx owns (namespaced by the `devctx` skill/command name), so there's no merge concern the way there is for the shared MCP config files above — the command just copies the template in verbatim, overwriting whatever was there.

## Hooks

Two kinds of hooks keep the index fresh automatically:

- **Config-level lifecycle hooks** (`hooks.postPull`, `hooks.postIndex` in config) — arbitrary shell commands run after `devctx sync` pulls repos, and after any indexing run (`devctx index` or `devctx sync`), respectively. Each runs with `DEVCTX_EVENT` and `DEVCTX_WORKSPACE` env vars set. A failing hook prints a warning but does not fail the command.
- **Git `post-commit` hook** (`devctx repo hook <name>`) — installs a real `.git/hooks/post-commit` script in that repo which backgrounds a `devctx index` run in the workspace after every local commit, so the index stays current even between `devctx sync` runs. This is opt-in per repo and won't overwrite an existing hook unless you pass `--force`.

## Extension Points

The index API lives in `src/indexing/IndexProvider.ts`. LanceDB is the default implementation, with local JSON available as a fallback.

The memory API lives in `src/memory/MemoryAdapter.ts`. MemPalace is the default durable memory provider, and local JSON remains available for simple/offline experiments.

Planned extension points:

- AI-generated documentation validation

Not planned: a MemPalace provider for CLI write operations (writes should go through MemPalace's own CLI/MCP tools, not devctx's document indexer — see `MempalaceMemory` in `src/memory/LocalJsonMemory.ts`), or an embeddings/vector-DB index provider (lexical/FTS search already covers this project's typical doc+code corpus well, and a local embedding model would mean a second native binary dependency for modest benefit). Both were deliberately decided against rather than merely deferred.
