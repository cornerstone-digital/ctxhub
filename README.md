# SSD CLI

`ssd` is a reusable CLI for AI-assisted development workspaces. It manages multi-repo context, indexes local documentation and source files in LanceDB, and leaves durable agent memory to MemPalace by default.

## Prerequisites

- Node.js 20+
- Git (only required if you want repo detection/`ssd sync` to do anything — SSD itself works without it)
- Optional: [MemPalace](https://github.com) CLI, if you use the default `memory.provider: mempalace`. Install with `uv tool install mempalace` (requires [uv](https://docs.astral.sh/uv/)). Without it, `ssd memory status`/`ssd doctor` will report it as unavailable but the rest of the CLI (indexing, search) still works — or set `memory.provider: local-json` in config to avoid the dependency entirely.
- Optional: an MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.), only needed if you use `ssd mcp`.

## Install

```bash
npm install
npm run build
npm link
```

For local development:

```bash
npm run ssd -- --help
```

## Quick Start

```bash
ssd init --name my-workspace
ssd repo add app ./app
ssd repo discover ../
ssd repo list
ssd index
ssd search "authentication flow"
ssd sync
ssd memory status
ssd doctor
ssd mcp
ssd agent claude
```

`ssd init` creates:

- `.ssd/config.yaml`
- `.ssd/index/`
- `.ssd/cache/`
- `.ssd/memory/`

Config is discovered from `ssd.yaml` first, then `.ssd/config.yaml`.

By default, `ssd search` uses the LanceDB-backed project index. MemPalace is configured separately as the durable agent memory layer so Claude/Codex/MCP clients can recall project decisions and session history without mixing that data into the source/document index.

## Config

See [ssd.example.yaml](./ssd.example.yaml).

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
hooks:
  postPull: "npm --prefix ./app install"
  postIndex: "echo indexed workspace $SSD_WORKSPACE"
```

## Commands

- `ssd init`: create workspace config and local SSD directories.
- `ssd repo add <name> <path>`: add a repo, validate the path, and detect Git.
- `ssd repo list`: print configured repos.
- `ssd repo discover [path]`: find Git repositories below a folder and add them.
- `ssd repo hook <name>`: install a `post-commit` Git hook in that repo which re-indexes the workspace in the background after each commit (`-f/--force` to overwrite an existing hook).
- `ssd index`: index changed workspace files.
- `ssd sync`: pull configured repos and re-index changed files.
- `ssd search <query>`: search the LanceDB project index.
- `ssd memory status`: show MemPalace memory status and LanceDB index status.
- `ssd memory clear`: clear the SSD index after confirmation; external MemPalace stores are left to MemPalace.
- `ssd doctor`: check Node, Git, config, repo paths, index directory, and memory provider.
- `ssd mcp`: start an MCP server (stdio) exposing `search`, `memory_status`, and `repo_list` as tools for AI agents.
- `ssd agent <name>`: write/merge `.mcp.json` for this workspace and launch the agent (currently `claude`; `--no-launch` to only write the config).

## MCP server

`ssd mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, so MCP-native clients (Claude Desktop, Claude Code, Cursor, etc.) can query the workspace index as structured tools instead of shelling out and parsing terminal output.

Tools exposed:

- `search(query, limit?)` — same ranked results as `ssd search`.
- `memory_status()` — same output as `ssd memory status`.
- `repo_list()` — same output as `ssd repo list`.

These are intentionally read-only. Mutating operations (`index`, `sync`, `memory clear`) stay CLI/human-driven rather than agent-callable, so an agent can look things up but can't rebuild or clear the index on its own.

Example client config (e.g. `claude_desktop_config.json` or a project's `.mcp.json`):

```json
{
  "mcpServers": {
    "ssd": {
      "command": "ssd",
      "args": ["mcp"],
      "cwd": "/path/to/your/workspace"
    }
  }
}
```

## Launching an agent

`ssd agent claude` writes (or merges into) a `.mcp.json` in the workspace root registering the `ssd` MCP server, then launches `claude` in the current directory so it picks the server up immediately:

```json
{
  "mcpServers": {
    "ssd": { "command": "ssd", "args": ["mcp"] }
  }
}
```

The merge preserves any other keys or MCP servers already in `.mcp.json` and is idempotent (running it again with no changes needed is a no-op). Pass `--no-launch` to only write the config without starting `claude` — useful in CI, or if you'd rather launch it yourself.

Only `claude` is supported today. Codex's MCP configuration lives outside a per-project file (in `~/.codex/config.toml`), so wiring it up automatically needs a different approach than the `.mcp.json` merge above — left as a follow-up rather than guessing at the format.

## Hooks

Two kinds of hooks keep the index fresh automatically:

- **Config-level lifecycle hooks** (`hooks.postPull`, `hooks.postIndex` in config) — arbitrary shell commands run after `ssd sync` pulls repos, and after any indexing run (`ssd index` or `ssd sync`), respectively. Each runs with `SSD_EVENT` and `SSD_WORKSPACE` env vars set. A failing hook prints a warning but does not fail the command.
- **Git `post-commit` hook** (`ssd repo hook <name>`) — installs a real `.git/hooks/post-commit` script in that repo which backgrounds a `ssd index` run in the workspace after every local commit, so the index stays current even between `ssd sync` runs. This is opt-in per repo and won't overwrite an existing hook unless you pass `--force`.

## Extension Points

The index API lives in `src/indexing/IndexProvider.ts`. LanceDB is the default implementation, with local JSON available as a fallback.

The memory API lives in `src/memory/MemoryAdapter.ts`. MemPalace is the default durable memory provider, and local JSON remains available for simple/offline experiments.

Planned extension points:

- Codex launch integration (see note above)
- embeddings/vector DB provider
- AI-generated documentation validation
