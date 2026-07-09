# ctxhub CLI

`ctxhub` is a reusable CLI for AI-assisted development workspaces. It manages multi-repo context, indexes local documentation and source files in LanceDB, and leaves durable agent memory to MemPalace by default.

## Prerequisites

- Node.js 20+
- Git (only required if you want repo detection/`ctxhub sync` to do anything — ctxhub itself works without it)
- Optional: [MemPalace](https://github.com) CLI, if you use the default `memory.provider: mempalace`. Install with `uv tool install mempalace` (requires [uv](https://docs.astral.sh/uv/)). Without it, `ctxhub memory status`/`ctxhub doctor` will report it as unavailable but the rest of the CLI (indexing, search) still works — or set `memory.provider: local-json` in config to avoid the dependency entirely.
- Optional: an MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.), only needed if you use `ctxhub mcp`.

## Install

Not published to npm yet (see [CONTRIBUTING.md](./CONTRIBUTING.md#releases) — `npmPublish` is intentionally off until this is ready to ship publicly). For now, install from a clone:

```bash
git clone <this-repo>
cd ctxhub
npm install
npm run build
npm link   # puts `ctxhub` on your PATH globally
```

Once published, this section will be `npm install -g ctxhub` (or `npx ctxhub@latest <command>` to run it without installing anything).

For local development, run against source without building:

```bash
npm run ctxhub -- --help
```

## Quick Start

The fastest path to a working setup is the interactive onboarding wizard:

```bash
ctxhub onboard
```

It walks through initializing the workspace, discovering repos, optionally installing a git post-commit hook per repo, optionally installing MemPalace if you want it, picking which coding agents to wire up (MCP config + a usage skill for each), and running an initial index — reusing the same underlying commands listed below, so anything it does you can also do manually, one step at a time:

```bash
ctxhub init --name my-workspace
ctxhub repo add app ./app
ctxhub repo discover ../
ctxhub repo list
ctxhub index
ctxhub search "authentication flow"
ctxhub sync
ctxhub memory status
ctxhub doctor
ctxhub mcp
ctxhub agent claude
ctxhub skills install
```

`ctxhub init` creates:

- `.ctxhub/config.yaml`
- `.ctxhub/index/`
- `.ctxhub/cache/`
- `.ctxhub/memory/`

Config is discovered from `ctxhub.yaml` first, then `.ctxhub/config.yaml`.

By default, `ctxhub search` uses the LanceDB-backed project index. MemPalace is configured separately as the durable agent memory layer so Claude/Codex/MCP clients can recall project decisions and session history without mixing that data into the source/document index.

## Config

See [ctxhub.example.yaml](./ctxhub.example.yaml).

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
hooks:
  postPull: "npm --prefix ./app install"
  postIndex: "echo indexed workspace $CTXHUB_WORKSPACE"
```

## Commands

- `ctxhub init`: create workspace config and local ctxhub directories.
- `ctxhub onboard`: interactive setup wizard — init, repo discovery, hooks, memory provider, agents, skills, and an initial index, in one guided flow.
- `ctxhub repo add <name> <path>`: add a repo, validate the path, and detect Git.
- `ctxhub repo list`: print configured repos.
- `ctxhub repo discover [path]`: find Git repositories below a folder and add them.
- `ctxhub repo hook <name>`: install a `post-commit` Git hook in that repo which re-indexes the workspace in the background after each commit (`-f/--force` to overwrite an existing hook).
- `ctxhub index`: index changed workspace files.
- `ctxhub sync`: pull configured repos and re-index changed files.
- `ctxhub search <query>`: search the LanceDB project index.
- `ctxhub memory status`: show MemPalace memory status and LanceDB index status.
- `ctxhub memory clear`: clear the ctxhub index after confirmation; external MemPalace stores are left to MemPalace.
- `ctxhub doctor`: check Node, Git, config schema version, repo paths, index directory, memory provider, and whether installed skills/agent MCP configs are stale relative to the currently installed ctxhub version.
- `ctxhub mcp`: start an MCP server (stdio) exposing `search`, `memory_status`, and `repo_list` as tools for AI agents.
- `ctxhub agent <name>`: write/merge the MCP config for `claude` (`.mcp.json`), `codex` (`.codex/config.toml`), or `copilot` (`~/.copilot/mcp-config.json`) and launch it (`--no-launch` to only write the config).
- `ctxhub skills install [agents...]`: install a chat-native "how to use ctxhub" skill/prompt for `claude`, `codex`, `copilot`, and/or `cursor` (default: all four).

## MCP server

`ctxhub mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, so MCP-native clients (Claude Desktop, Claude Code, Cursor, etc.) can query the workspace index as structured tools instead of shelling out and parsing terminal output.

Tools exposed:

- `search(query, limit?)` — same ranked results as `ctxhub search`.
- `memory_status()` — same output as `ctxhub memory status`.
- `repo_list()` — same output as `ctxhub repo list`.

These are intentionally read-only. Mutating operations (`index`, `sync`, `memory clear`) stay CLI/human-driven rather than agent-callable, so an agent can look things up but can't rebuild or clear the index on its own.

Example client config (e.g. `claude_desktop_config.json` or a project's `.mcp.json`):

```json
{
  "mcpServers": {
    "ctxhub": {
      "command": "ctxhub",
      "args": ["mcp"],
      "cwd": "/path/to/your/workspace"
    }
  }
}
```

## Launching an agent

`ctxhub agent <claude|codex|copilot>` writes (or merges into) that agent's MCP config to register the `ctxhub` MCP server, then launches the agent in the current directory so it picks the server up immediately. Pass `--no-launch` to only write the config without starting the agent — useful in CI, or if you'd rather launch it yourself.

**Claude** — merges into `.mcp.json` (project-scoped):

```json
{
  "mcpServers": {
    "ctxhub": { "command": "ctxhub", "args": ["mcp"] }
  }
}
```

**Codex** — merges into `.codex/config.toml` (project-scoped):

```toml
[mcp_servers.ctxhub]
command = "ctxhub"
args = ["mcp"]
```

Codex only loads project-scoped `.codex/config.toml` for projects it trusts (untrusted projects skip it entirely — see [openai/codex#13025](https://github.com/openai/codex/issues/13025)); `ctxhub agent codex` prints a reminder of this after writing the config, since there's no way for ctxhub to grant that trust on Codex's behalf.

**Copilot** (the `copilot` CLI) — merges into `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`):

```json
{
  "mcpServers": {
    "ctxhub": { "type": "local", "command": "ctxhub", "args": ["mcp"], "tools": ["*"] }
  }
}
```

This one is **user-level, not project-scoped** — GitHub doesn't document a supported project-scoped file for the Copilot CLI (only the unrelated VS Code extension's `.vscode/mcp.json`, and the GitHub.com cloud coding agent's web-UI-only config). It still works per-project in practice, since the `ctxhub` server always uses whichever directory `copilot` is launched from. `ctxhub agent copilot` prints a note about this scope difference.

All merges preserve any other keys or servers already in the file and are idempotent — running the command again when nothing needs to change is a no-op, and TOML/JSON values round-trip correctly, though comments and formatting in a hand-edited file are not preserved on rewrite (the same tradeoff this project already accepts for its own `ctxhub.yaml` via `js-yaml`).

## Installable skills

`ctxhub skills install [agents...]` copies a small "how to use ctxhub in this workspace" skill/prompt file into one or more coding agents' own conventions, so the agent knows to check the index *before* answering questions about this codebase — this complements the MCP server (which grants tool access) with usage guidance (which nudges *when* to use it), and still helps agents that don't have the MCP server wired up, since it also documents the plain CLI commands. Run with no arguments to install for all four; name specific agents (e.g. `ctxhub skills install claude cursor`) to limit it.

The templates themselves live in this repo under [`skills/`](./skills/) and are plain, static files — copy them in by hand instead of running the command if you'd rather not install the CLI at all:

| Agent | Template | Installs to |
| --- | --- | --- |
| `claude` | [`skills/claude/SKILL.md`](./skills/claude/SKILL.md) | `.claude/skills/ctxhub/SKILL.md` |
| `codex` | [`skills/codex/SKILL.md`](./skills/codex/SKILL.md) | `.agents/skills/ctxhub/SKILL.md` (identical content to Claude's — Codex's skills format is compatible) |
| `copilot` | [`skills/copilot/ctxhub.prompt.md`](./skills/copilot/ctxhub.prompt.md) | `.github/prompts/ctxhub.prompt.md` |
| `cursor` | [`skills/cursor/ctxhub.md`](./skills/cursor/ctxhub.md) | `.cursor/commands/ctxhub.md` |

Each destination is a dedicated file ctxhub owns (namespaced by the `ctxhub` skill/command name), so there's no merge concern the way there is for the shared MCP config files above — the command just copies the template in verbatim, overwriting whatever was there.

## Detecting stale skills and agent configs

Installed skill files and agent MCP configs are snapshots written at install time — if you upgrade ctxhub later (a revised skill description, a changed MCP entry shape), anything already installed in a workspace stays exactly as it was until you re-run the install command. `ctxhub doctor` catches this drift for anything it finds installed (it stays silent about agents/skills you never set up in the first place):

```text
! claude skill is outdated. Run: ctxhub skills install claude
! codex MCP config is outdated. Run: ctxhub agent codex --no-launch
✓ copilot skill up to date
```

It also flags a `config.yaml` schema version mismatch (`version: 1` today) the same way, in case a future ctxhub version changes the config shape. None of this is auto-fixed — `doctor` only diagnoses and tells you the exact command to run, consistent with the rest of its checks.

## Hooks

Two kinds of hooks keep the index fresh automatically:

- **Config-level lifecycle hooks** (`hooks.postPull`, `hooks.postIndex` in config) — arbitrary shell commands run after `ctxhub sync` pulls repos, and after any indexing run (`ctxhub index` or `ctxhub sync`), respectively. Each runs with `CTXHUB_EVENT` and `CTXHUB_WORKSPACE` env vars set. A failing hook prints a warning but does not fail the command.
- **Git `post-commit` hook** (`ctxhub repo hook <name>`) — installs a real `.git/hooks/post-commit` script in that repo which backgrounds a `ctxhub index` run in the workspace after every local commit, so the index stays current even between `ctxhub sync` runs. This is opt-in per repo and won't overwrite an existing hook unless you pass `--force`.

## Extension Points

The index API lives in `src/indexing/IndexProvider.ts`. LanceDB is the default implementation, with local JSON available as a fallback.

The memory API lives in `src/memory/MemoryAdapter.ts`. MemPalace is the default durable memory provider, and local JSON remains available for simple/offline experiments.

See [ROADMAP.md](./ROADMAP.md) for what's shipped, what's planned, and what's explicitly not planned.
