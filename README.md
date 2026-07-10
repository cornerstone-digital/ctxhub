# ctxhub CLI

`ctxhub` is a reusable CLI for AI-assisted development workspaces. It manages multi-repo context, indexes local documentation and source files in LanceDB, and leaves durable agent memory to MemPalace by default.

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Way of working](#way-of-working) — start here for the actual day-to-day workflow
- [Quick Start](#quick-start) — manual step-by-step equivalent of `onboard`
- [Config](#config)
- [Guided mode](#guided-mode)
- [Interactive defaults and automation](#interactive-defaults-and-automation)
- [Commands](#commands)
- [MCP server](#mcp-server)
- [Source-aware context](#source-aware-context)
- [Launching an agent](#launching-an-agent)
- [Two kinds of agent memory](#two-kinds-of-agent-memory)
- [Installable skills](#installable-skills)
- [Detecting stale skills and agent configs](#detecting-stale-skills-and-agent-configs)
- [Hooks](#hooks)
- [Extension Points](#extension-points)

## Prerequisites

- Node.js 22+
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

## Way of working

**One-time, per workspace:**

```bash
ctxhub onboard
```

Run this once in the folder containing your multi-repo workspace (a parent directory holding several git repos, or a single repo). It opens a live terminal wizard, sets up the index, wires up the MCP server and skills for whichever agents you use, and optionally a git hook to keep the index fresh — see [Quick Start](#quick-start) below for the manual, step-by-step equivalent if you'd rather not use the wizard.

**Day to day: you mostly don't touch the CLI.** That's the point of the MCP server and skills — once set up:

- Ask Claude Code, Codex, or Copilot a question about the codebase as normal. The installed `ctxhub` skill nudges the agent to check the index first when the answer might live in a *different* repo than the one you have open, without you needing to remember ctxhub exists.
- Want a search right now, on demand? `/ctxhub-search <query>` in Claude Code or Codex triggers it explicitly (see [Installable skills](#installable-skills)).
- The index stays current however you set it up during onboarding: an automatic `post-commit` git hook per repo, or a manual `ctxhub sync` (which also pulls each repo first; use `ctxhub sync --no-pull` when you only want to re-index).
- Learned something worth remembering? Two different paths depending on who it's for — see [Two kinds of agent memory](#two-kinds-of-agent-memory): personal/session notes go to MemPalace (already wired up by `ctxhub agent <name>` if configured), team-shared notes go through `ctxhub note add <repo> "<title>"` and a normal PR.

**Worked example**, inside a Claude Code session at the workspace root or inside any configured child repo, no CLI commands typed:

> **You**: How does the webhook receiver authenticate before invoking the notifications service?
>
> **Claude**: *(reaches for the `search` MCP tool, since the answer spans two repos)* — reads results from `webhooks-service` and `notifications-service`, answers with citations to both.

**Occasional maintenance:**

- Added a new repo to the workspace? `ctxhub repo add <name> <path>` (or re-run `ctxhub repo discover`).
- Upgraded ctxhub? Nothing to remember — the next command you run anywhere in the workspace prints a one-line nudge if a skill or agent config is now stale (see [Detecting stale skills and agent configs](#detecting-stale-skills-and-agent-configs)).
- Something feels off? `ctxhub doctor` gives a full health check.

## Quick Start

The manual, step-by-step equivalent of `ctxhub onboard`, if you'd rather run each piece yourself:

```bash
ctxhub init --name my-workspace
ctxhub repo add app ./app
ctxhub repo discover ../
ctxhub repo list
ctxhub index
ctxhub search "authentication flow"
ctxhub pack "how does authentication work?"
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

Config is discovered by walking upward from the current directory. At each directory, ctxhub checks `ctxhub.yaml` first, then `.ctxhub/config.yaml`; the directory containing that config becomes the workspace root for repo paths, index files, reports, hooks, skills, and MCP agent config. This means you can run `ctxhub search`, `ctxhub index`, or an agent-launched `ctxhub mcp` from inside `my-workspace/some-repo/` and it will still use the parent workspace index. `ctxhub init` is the exception: it intentionally creates a new config in the exact directory where you run it.

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
      - "docs/architecture/**/*.mmd"
      - "diagrams/**/*.mmd"
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
privacy:
  redactPatterns:
    - "(api[_-]?key|token|secret|password)\\s*[:=]\\s*[^\\s]+"
    - "AKIA[0-9A-Z]{16}"
llm:
  enabled: false
  timeoutMs: 120000
```

## LLM-backed features

Most of ctxhub is a read-only search/index/context server with no LLM calls of its own. A small, growing set of features are the exception — they shell out to whichever coding-agent CLI your workspace already has configured (`claude`, `codex`, `copilot`, or `cursor`) to run one bounded, non-interactive task, then use its output. These are **off by default** and opt-in at the config level:

```yaml
llm:
  enabled: false   # set true to turn on every LLM-backed feature below
  agent: claude    # optional -- which CLI to use. Auto-detects claude/codex/copilot/cursor on PATH if unset
  timeoutMs: 120000
```

Turning it on is worth it: `ctxhub explain` goes from a templated evidence listing to a real, synthesized, cited answer to your actual question — the same evidence, read for you instead of by you.

Today, `llm.enabled` gates:

- **`ctxhub explain <query>`** — synthesizes a cited answer from retrieved evidence via your configured agent CLI, instead of the non-LLM evidence scaffold. Never invents a citation — it's instructed to cite only the evidence it was given, and falls back to the scaffold if the LLM call is disabled, unavailable, or times out. Override per-invocation with `--llm`/`--no-llm` regardless of the config default.
- **`ctxhub eval --agent-report`** — checks whether an agent, given ctxhub's tool descriptions, actually reaches for the tool the skill docs recommend for a set of realistic questions (seeded from the skill's own documented guidance). Writes a Markdown report under `.ctxhub/cache/evals/agent-*.md`. A mismatch is a real finding — it means the agent and the skill docs disagree about what to reach for.
- **`ctxhub onboard`** — after every other setup step, prints a short workspace orientation summarizing what the workspace is and how its repos relate, grounded only in what ctxhub actually indexed. Skipped (with a value-prop notice) when disabled.
- **`ctxhub pr-context`** — reviews the actual diff (not just changed file names) for cross-repo contract breaks, naming specific consuming repos and the specific risk (a renamed export, a changed signature, etc.). Only ever names repos ctxhub's index actually knows about. `--llm`/`--no-llm` override the config default for one call.
- **`ctxhub graph --drift`** — for each drift finding with an existing diagram to fix, suggests a specific repair (e.g. renaming a component to match the real repo/package name), shown as a diff against the real file content for review. Never auto-applied, never affects `--fail-on-drift`'s CI behavior.
- **`ctxhub handoff`** — adds a synthesized `## Summary` section citing only the evidence already in the bundle, alongside (not replacing) the existing structured sections.
- **`ctxhub note add --draft` / `ctxhub diagram add --draft`** — replace the empty scaffold body with an AI-drafted note or Mermaid diagram grounded in recent commits plus indexed ctxhub evidence, clearly marked as pending human review.
- **`ctxhub repo add --suggest-globs` / `ctxhub repo discover --suggest-globs`** — inspect a newly added repo and print a suggested per-repo `include`/`exclude` diff for `ctxhub.yaml`, grounded in the repo's layout, without auto-applying it.

If a command's LLM path is unavailable (disabled, no agent CLI found, timed out), it always falls back to its non-LLM behavior and explains why in the output — it never just silently does less. `ctxhub doctor` reports whether LLM-backed features are enabled, which agent is configured/detected, and whether that agent's CLI is actually reachable on PATH.

More LLM-backed features (PR/handoff description synthesis, drift-repair suggestions, and others) are scoped in [NEXT_FEATURES.md](./NEXT_FEATURES.md) and will land behind this same flag.

## Guided mode

Running `ctxhub` with no arguments (in a real terminal) launches an interactive, menu-driven mode: type to filter the full command list (grouped by category), arrow keys + enter to pick one, then a short step-by-step wizard collects its arguments/options (text input, yes/no toggles, single/multi-select lists as appropriate) before showing you the exact command it's about to run and asking for confirmation. It then runs that command for real — same code path, same output, same confirmations (e.g. `memory clear`'s prompt) as typing it yourself — and drops you back at the menu afterward. `ctxhub menu` is the same thing as an explicit, discoverable command if you'd rather not rely on the no-args shortcut.

Guided mode is generated directly from that same command tree (so it can't drift out of sync with it), with one exception — `ctxhub mcp` is left out of the menu, since it starts a long-running server meant to be launched by an agent's MCP config, not picked from a menu.

## Interactive defaults and automation

ctxhub prefers rich terminal views for humans and plain output for automation. If stdin/stdout are real TTYs and `CI`/`GITHUB_ACTIONS` are not set, commands with a useful terminal UI use it by default: `index`, `sync`, `doctor`, `repo discover`, `memory status`, and `search`. When output is piped, JSON is requested, or a common CI environment is detected, ctxhub automatically falls back to script-friendly output.

Use these flags when you need to force the mode:

- `--plain`: prefer script-friendly text output and skip review/progress panels.
- `--no-interactive`: disable interactive terminal views.
- `--json`: for commands that support it, always emit machine-readable JSON.

Examples:

```bash
ctxhub search "auth"          # live search UI in a terminal, seeded with auth
ctxhub search --plain "auth"  # one-shot output for agents/scripts
ctxhub --plain doctor         # plain health-check output
ctxhub eval --json            # CI-friendly eval payload
```

## Commands

- `ctxhub menu`: launch the interactive guided menu (see [Guided mode](#guided-mode) above) — also the default when you run bare `ctxhub` with no arguments in a terminal.
- `ctxhub init`: create workspace config and local ctxhub directories.
- `ctxhub onboard`: live terminal setup wizard — init, repo discovery, hooks, memory provider, agents, skills, and an initial index, in one guided flow. Requires a real terminal; use the [Quick Start](#quick-start) commands for non-interactive scripts.
- `ctxhub repo add <name> <path> [--suggest-globs]`: add a repo, validate the path, and detect Git. `--suggest-globs` asks the configured agent CLI for a repo-specific `include`/`exclude` diff without changing config automatically.
- `ctxhub repo list`: print configured repos.
- `ctxhub repo discover [path] [--suggest-globs]`: find Git repositories below a folder. In a real terminal it opens a review screen so you can choose which new repos to add; use `--plain` to auto-add new repos. `--suggest-globs` prints repo-specific `include`/`exclude` diff suggestions for each newly added repo when `llm.enabled`.
- `ctxhub repo hook <name>`: install a `post-commit` Git hook in that repo which re-indexes the workspace in the background after each commit (`-f/--force` to overwrite an existing hook).
- `ctxhub ci init [--with-eval]`: create a GitHub Actions workflow that runs build, `ctxhub validate docs`, and optionally `ctxhub eval` on pull requests.
- `ctxhub index`: index changed workspace files. In a real terminal it shows per-repo progress, then prints the durable summary; use `--plain` to force plain progress output.
- `ctxhub sync [--no-pull]`: pull configured repos and re-index changed files. In a real terminal it shows separate pull and index progress; `--no-pull` skips the Git pull phase and `--plain` forces plain progress output.
- `ctxhub search [query]`: search the LanceDB project index. Use `--type all|docs|code|architecture|notes`, or shortcuts like `--code` and `--docs`, when you know what kind of evidence you want. In a real terminal it opens live search by default, seeded with the query when provided — type to search-as-you-type, tab cycles result-type facets, arrow keys move, enter views the full chunk, esc goes back/quits. Use `ctxhub search --plain "<query>"` for one-shot output.
- `ctxhub pack <query>`: assemble an agent-ready context pack with search hits, architecture hits, freshness, status, repos, result-type counts, local `rg` follow-up suggestions, and suggested reading order. Add `--out <file>` to save a portable replay artifact.
- `ctxhub explain <query>`: create a citation-first explanation from indexed context without inventing uncited claims — a real LLM-synthesized answer when `llm.enabled` (see [LLM-backed features](#llm-backed-features)), otherwise a non-LLM evidence scaffold. `--llm`/`--no-llm` override the config default for one call.
- `ctxhub replay <file>`: replay an exported context pack artifact and compare recorded repo HEADs against the current workspace.
- `ctxhub open <id>`: print a full indexed chunk returned by search or a context pack.
- `ctxhub pr-context [--base origin/main]`: build a context pack for files changed on the current branch, with LLM-backed cross-repo contract-risk review when `llm.enabled` (see [LLM-backed features](#llm-backed-features)).
- `ctxhub handoff <topic> [--from-pr]`: create a Markdown handoff bundle under `.ctxhub/cache/handoffs/` for another agent or teammate, with an LLM-synthesized summary section when `llm.enabled` (see [LLM-backed features](#llm-backed-features)).
- `ctxhub watch [--interval 30]`: continuously re-index changed workspace files during active development, with a live per-repo progress view in a real terminal.
- `ctxhub report [-o <path>] [--open]`: generate a self-contained, browsable HTML report of workspace status, repos, architecture diagrams, and the most recently indexed chunks, with a client-side search box and stale-result highlighting (no server, no external assets). `--open` launches the generated file in your browser.
- `ctxhub memory status`: show MemPalace memory status and LanceDB index status. In a real terminal it renders a compact status panel; use `--plain` for script-friendly output.
- `ctxhub memory clear`: clear the ctxhub index after confirmation; external MemPalace stores are left to MemPalace.
- `ctxhub doctor [--fix] [--dry-run] [--fix-skills] [--fix-agent <name>]`: check Node, Git, config schema version, repo paths, index directory, memory provider, and whether installed skills/agent MCP configs are stale relative to the currently installed ctxhub version. In a real terminal it renders a live checklist before printing the final lines; use `--plain` for script-friendly output. `--fix` applies safe, low-risk repairs (missing `.ctxhub` directories, default `privacy.redactPatterns`); `--dry-run` previews those changes without writing anything; `--fix-skills`/`--fix-agent <name>` are separate opt-in flags for the more invasive fixes (reinstalling stale skill files, refreshing an agent's MCP config), since those overwrite files you may have installed deliberately.
- `ctxhub mcp`: start an MCP server (stdio) exposing read-only context tools for AI agents (`--allow-index` adds opt-in mutating index/sync tools).
- `ctxhub agent <name>`: write/merge the MCP config for `claude` (`.mcp.json`), `codex` (`.codex/config.toml`), or `copilot` (`~/.copilot/mcp-config.json`) at the discovered workspace root and launch it (`--no-launch` to only write the config). Also wires up MemPalace's own MCP server alongside ctxhub's when configured and available.
- `ctxhub skills install [agents...]`: install chat-native "how to use ctxhub" skills for `claude`, `codex`, `copilot`, and/or `cursor` at the discovered workspace root, then link those files into each configured child repo so repo-root agent sessions can discover them (default: all four).
- `ctxhub note add <repo> "<title>" [--agent <name>] [--draft]`: scaffold a dated, consistently-formatted note file under `<repo>/agent-notes/` for anything worth a teammate seeing in a PR (see [Two kinds of agent memory](#two-kinds-of-agent-memory)). `--draft` asks the configured agent CLI to write a first draft from recent commits and indexed context when `llm.enabled`.
- `ctxhub diagram add <repo> "<title>" [--agent <name>] [--draft]`: scaffold a dated Mermaid `.mmd` architecture diagram under `<repo>/docs/architecture/` for reviewable team architecture context. `--draft` asks the configured agent CLI to draft Mermaid content from recent commits and indexed context when `llm.enabled`.
- `ctxhub graph [--json|--drift]`: summarize workspace components and relationships from indexed diagrams plus package metadata; `--drift` flags missing or unknown architecture references and `--fail-on-drift` makes those findings CI-failing. With `llm.enabled`, also suggests specific repairs for drift findings (see [LLM-backed features](#llm-backed-features)).
- `ctxhub validate docs [--json|--strict-diagrams]`: check Markdown local links and Mermaid diagram declarations; strict mode adds dependency-light Mermaid delimiter and relationship syntax checks.
- `ctxhub eval [--init|--file <path>|--report|--json]`: run golden query checks against the index, write run history under `.ctxhub/cache/evals/`, and optionally generate a Markdown quality report. Use `--json` in CI.
- `ctxhub eval --agent-report [--file <path>|--json]`: check whether an agent reaches for the tool ctxhub's skill docs recommend for a set of realistic questions (requires `llm.enabled`, see [LLM-backed features](#llm-backed-features)).

The default config excludes `.env` files and redacts common secret-looking values before content is written to the index. `privacy.redactPatterns` accepts JavaScript regular expression source strings; matches are replaced with `[REDACTED]`.

## MCP server

`ctxhub mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, so MCP-native clients (Claude Desktop, Claude Code, Cursor, etc.) can query the workspace index as structured tools instead of shelling out and parsing terminal output.

The server uses the same upward config discovery as the CLI. If an agent launches it while the current working directory is `my-workspace/some-repo`, ctxhub climbs to `my-workspace/ctxhub.yaml` or `my-workspace/.ctxhub/config.yaml`, then resolves all configured repo/index paths from that workspace root.

Tools exposed:

- `search(query, limit?, type?)` — ranked results plus result-type labels and local `rg` follow-up hints. `type` can be `all`, `docs`, `code`, `architecture`, or `notes`; use `code` when an agent needs exact implementation/symbol starting points before local file reads.
- `context_pack(query, limit?)` — same bundle as `ctxhub pack --json`.
- `open_chunk(id)` — return a full indexed chunk from a search/context-pack result. For TS/JS/JSX files, chunks are already whole top-level functions/classes rather than arbitrary paragraph slices (see [Source-aware context](#source-aware-context) below).
- `get_file_context(repo, path, line?, before?, after?, mode?)` — return context around a line. For TS/JS/JSX files this defaults (`mode: "auto"`) to the full enclosing function/method/class; pass `mode: "lines"` to force the old before/after line window.
- `memory_status()` — same output as `ctxhub memory status`.
- `repo_list()` — same output as `ctxhub repo list`.
- `architecture_search(query, limit?)` — search indexed Mermaid diagrams and Mermaid code blocks.
- `architecture_map(query?)` — summarize known components and relationships extracted from indexed diagrams.

These are intentionally read-only by default. Mutating operations stay CLI/human-driven unless you start the MCP server with `ctxhub mcp --allow-index`, which adds `index_workspace(force?)` and `sync_workspace(noPull?)`. `memory clear` is never exposed over MCP.

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

## Source-aware context

Indexed TS/JS/JSX source is chunked by top-level function/method/class instead of blank-line paragraphs, so a search hit or `open_chunk` result on a code file is already a whole, syntactically complete symbol — not a slice cut off mid-function. This uses a lightweight, dependency-free brace-matching heuristic (`src/context/symbols.ts`), not a real TS parser, so it can miss unusual formatting; when it can't confidently find a symbol it falls back to plain paragraph chunking (indexing) or a before/after line window (`get_file_context`), never an error.

`get_file_context(repo, path, line)` uses the same heuristic: given a line number, it returns the full enclosing function/method/class by default. Pass `mode: "lines"` if you specifically want the old fixed line window instead.

## Launching an agent

`ctxhub agent <claude|codex|copilot>` writes (or merges into) that agent's MCP config to register the `ctxhub` MCP server, then launches the agent in the current directory so it picks the server up immediately. Pass `--no-launch` to only write the config without starting the agent — useful in CI, or if you'd rather launch it yourself.

When a ctxhub config is discoverable above the current directory, project-scoped agent config is written at that workspace root. For example, running `ctxhub agent claude --no-launch` from `my-workspace/api-service` updates `my-workspace/.mcp.json`, not `my-workspace/api-service/.mcp.json`. Launching the agent from the child repo still works because `ctxhub mcp` also climbs back to the workspace config.

If `memory.provider: mempalace` (the default) and the `mempalace` CLI is actually installed, this also wires up MemPalace's own MCP server (`mempalace-mcp`) alongside ctxhub's, in the same config file — see [Two kinds of agent memory](#two-kinds-of-agent-memory) for why. Skipped silently if MemPalace isn't installed, or if `memory.provider` is `local-json`.

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

## Two kinds of agent memory

ctxhub's own index is deliberately **read-only** — a mirror of this workspace's actual repo content, refreshed from git via `ctxhub sync`/the post-commit hook. It's not a place for an agent to stash its own notes, and that's on purpose: mixing "official repo content" with "agent scratch notes" in the same search results would make both worse. Two separate, purpose-built paths exist instead, for two different needs:

| | **MemPalace** (personal/session memory) | **`ctxhub note add`** (team-shared notes) |
| --- | --- | --- |
| For | Things worth remembering across your own sessions — a decision, a workaround, a gotcha | Things worth a teammate seeing and reviewing |
| Where it lives | `~/.mempalace/` (local, per-user, not git-tracked) | `<repo>/agent-notes/<date>-<slug>.md` (git-tracked, in the repo itself) |
| How it's written | MemPalace's own MCP tools (`mempalace_add_drawer`, `mempalace_checkpoint`, `mempalace_diary_write`, and 16 others) — wired up automatically by `ctxhub agent <name>` alongside ctxhub's own server, when `memory.provider: mempalace` and MemPalace is installed | `ctxhub note add <repo> "<title>" --agent <name>` scaffolds a dated, consistently-formatted stub; the agent fills in the body with its own file-edit tool |
| Visibility | Not shared with the team, not indexed by ctxhub | Shows up in the normal PR diff for review; once merged, ctxhub indexes it like any other doc (it already matches the default `**/*.md` include glob) |

ctxhub doesn't reimplement either of these — MemPalace already has a mature, write-capable MCP surface, and "write a markdown file" is something every agent can already do with its own file tools. ctxhub's job is just making the two paths unambiguous: which one to use, and where the shared one is looked for/indexed.

Architecture diagrams use the same team-shared path. `ctxhub diagram add <repo> "<title>" --agent <name>` creates a reviewable Mermaid file under `<repo>/docs/architecture/`; the agent or developer edits it like normal code, and the PR makes the architecture change visible to the team. ctxhub indexes `.mmd`/`.mermaid` files and fenced Mermaid blocks in Markdown, extracts component and relationship metadata, and exposes architecture-specific MCP tools so agents can understand system shape instead of reconstructing it from scattered text hits.

## Installable skills

`ctxhub skills install [agents...]` installs focused skills per agent, mirroring the skills-mode pattern [spec-kit](https://github.com/github/spec-kit) uses — one focused skill per action rather than one skill trying to do everything:

- **`ctxhub`** — ambient guidance, auto-invoked when the agent's own judgment matches the description (e.g. "the answer might be in a different repo"). No arguments; this is the "don't forget the index exists" nudge.
- **`ctxhub-search`** — explicit, on-demand search. In Claude Code and Codex this is invoked directly as `/ctxhub-search <query>`, with `$ARGUMENTS` handling in the skill body so the typed query is unambiguous rather than left to the model's interpretation — the same pattern spec-kit's own commands use. It teaches agents to use typed search (`code`, `docs`, `architecture`, `notes`) and then switch to local `rg`/file context for exact implementation work. Codex may show this via a `/skills` picker or `$ctxhub-search` rather than an identical `/name` syntax; worth checking your Codex version.
- **`ctxhub-context`** — explicit context-pack gathering for broad cross-repo questions where the agent should read a suggested path and architecture/freshness evidence before answering.
- **`ctxhub-note`** — explicit team-note capture for durable findings that should live in a repo under `agent-notes/` and be reviewed/indexed with the codebase.
- **`ctxhub-diagram`** — explicit Mermaid architecture capture for system relationships, request/event flows, ownership boundaries, integrations, or runtime topology.

This complements the MCP server (which grants tool access) with usage guidance (which nudges *when* and *how* to use it), and still helps agents that don't have the MCP server wired up, since it also documents the plain CLI commands. Run with no arguments to install the full skill set for all four agents; name specific agents (e.g. `ctxhub skills install claude cursor`) to limit it.

Skills are project-scoped files. If a ctxhub config is discoverable above your current directory, `ctxhub skills install` writes canonical copies at that workspace root. For GitHub/Copilot, ctxhub follows Spec Kit's skills-mode layout: `.github/skills/<name>/SKILL.md`. For Cursor, ctxhub follows Spec Kit's current `.cursor/skills/<name>/SKILL.md` layout. It also creates repo-local links for every configured child repo, e.g. `my-workspace/api-service/.claude/skills/...` or `my-workspace/api-service/.github/skills/...` points back to the workspace copy. That keeps agent sessions launched at a child repo root from missing skills when the workspace root sits above the repo's Git root. If symlinks are unavailable, ctxhub falls back to copying the file.

The templates themselves live in this repo under [`skills/`](./skills/) and are plain, static files — copy them in by hand instead of running the command if you'd rather not install the CLI at all:

| Agent | Templates | Installs to |
| --- | --- | --- |
| `claude` | `skills/claude/<skill>/SKILL.md` for `ctxhub`, `ctxhub-search`, `ctxhub-context`, `ctxhub-note`, `ctxhub-diagram` | `.claude/skills/<skill>/SKILL.md` |
| `codex` | `skills/codex/<skill>/SKILL.md` for the same five skills | `.agents/skills/<skill>/SKILL.md` (identical content to Claude's — Codex's skills format is compatible) |
| `copilot` | `skills/copilot/<skill>/SKILL.md` for the same five skills | `.github/skills/<skill>/SKILL.md` |
| `cursor` | `skills/cursor/<skill>/SKILL.md` for the same five skills | `.cursor/skills/<skill>/SKILL.md` |

Each destination is a dedicated file ctxhub owns (namespaced by skill name), so there's no merge concern the way there is for the shared MCP config files above — the command just copies each template in verbatim, overwriting whatever was there.

## Detecting stale skills and agent configs

Installed skill files and agent MCP configs are snapshots written at install time — if you upgrade ctxhub later (a revised skill description, a changed MCP entry shape), anything already installed in a workspace stays exactly as it was until you re-run the install command. `ctxhub doctor` catches this drift for anything it finds installed (it stays silent about agents/skills you never set up in the first place):

```text
! claude:ctxhub skill is outdated. Run: ctxhub skills install claude
! codex MCP config is outdated. Run: ctxhub agent codex --no-launch
✓ claude:ctxhub-search skill up to date
```

It also flags a `config.yaml` schema version mismatch (`version: 1` today) the same way, in case a future ctxhub version changes the config shape. Plain `ctxhub doctor` only diagnoses and tells you the exact command to run. `ctxhub doctor --fix` will apply the safe, mechanical fixes itself — creating missing `.ctxhub` directories and filling in default `privacy.redactPatterns` if you've cleared them — but stops short of touching anything you installed on purpose. Reinstalling stale skill files or refreshing an agent's MCP config needs the explicit `--fix-skills` or `--fix-agent <name>` flag, and `--dry-run` shows what any of this would do before it does it.

You don't have to remember to run `doctor` yourself, though: every command checks for this automatically the first time you run *any* `ctxhub` command after upgrading to a new version, and prints a one-line nudge to stderr if it finds drift —

```text
! ctxhub was upgraded to 0.2.0 — 2 installed skill/config item(s) may be outdated. Run `ctxhub doctor` for details.
```

— then goes quiet again for the rest of that version's lifetime (tracked in `.ctxhub/cache/last-checked-version`), so it nudges you once per upgrade rather than nagging on every single command. This check is skipped for `init`, `onboard`, and `doctor` (nothing to be stale yet, or already handled in full detail) and for `mcp` (never risk writing to stdout mid-JSON-RPC-handshake).

## Hooks

Two kinds of hooks keep the index fresh automatically:

- **Config-level lifecycle hooks** (`hooks.postPull`, `hooks.postIndex` in config) — arbitrary shell commands run after `ctxhub sync` pulls repos, and after any indexing run (`ctxhub index` or `ctxhub sync`), respectively. Each runs with `CTXHUB_EVENT` and `CTXHUB_WORKSPACE` env vars set. A failing hook prints a warning but does not fail the command.
- **Git `post-commit` hook** (`ctxhub repo hook <name>`) — installs a real `.git/hooks/post-commit` script in that repo which backgrounds a `ctxhub index` run in the workspace after every local commit, so the index stays current even between `ctxhub sync` runs. This is opt-in per repo and won't overwrite an existing hook unless you pass `--force`.

## Extension Points

The index API lives in `src/indexing/IndexProvider.ts`. LanceDB is the default implementation, with local JSON available as a fallback.

The memory API lives in `src/memory/MemoryAdapter.ts`. MemPalace is the default durable memory provider, and local JSON remains available for simple/offline experiments.

See [ROADMAP.md](./ROADMAP.md) for what's shipped, what's planned, and what's explicitly not planned.
