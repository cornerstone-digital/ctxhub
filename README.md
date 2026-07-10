# ctxhub CLI

`ctxhub` is a reusable CLI for AI-assisted development workspaces. It manages multi-repo context, indexes local documentation and source files in LanceDB, and leaves durable agent memory to MemPalace by default. It's also growing into a customizable orchestration framework — a local control plane (see [docs/control-plane.md](./docs/control-plane.md)) for running your own agentic workflows across workspaces, on top of the same context/memory fabric.

New here? **[docs/quickstart.md](./docs/quickstart.md)** gets you to a working demo in minutes (including a pre-built [reference workspace](./examples/reference-workspace/), no setup required). **[docs/philosophy.md](./docs/philosophy.md)** explains why ctxhub is shaped the way it is. **[docs/architecture.md](./docs/architecture.md)** explains how the pieces underneath actually work. This README is the command/config reference.

- [Prerequisites](#prerequisites)
- [Install](#install)
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

## Way of working and Quick Start

Moved to **[docs/quickstart.md](./docs/quickstart.md)**: the fastest path (the pre-built [reference
workspace](./examples/reference-workspace/), no setup), the guided `ctxhub onboard` wizard and
day-to-day workflow, and the manual step-by-step equivalent for anyone who'd rather run each piece
themselves.

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
  concurrency: 8 # optional; how many files' read/hash/chunk/summarize step runs at once during indexing
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
- **`ctxhub review <topic> --as <persona>`** — any `kind: "generic"` persona (the built-in `bug-hunter`/`security`/`performance`, or a custom one a team adds to `review-profiles.json`) synthesizes findings from the same diff/context-pack evidence `pr-context` and `handoff` already use, using that persona's own `focus` text as the prompt. Falls back to the raw evidence bundle (changed files + suggested context, no findings) when disabled, unavailable, or timed out. The built-in `contract` and `docs` personas (`kind: "contract"`/`"docs"`) don't call the LLM directly themselves — they reuse `pr-context`'s contract-risk review and `graph --drift`'s repair suggestions as-is, so their own `--llm`/`llm.enabled` behavior applies unchanged.
- **`ctxhub note add --draft` / `ctxhub diagram add --draft`** — replace the empty scaffold body with an AI-drafted note or Mermaid diagram grounded in recent commits plus indexed ctxhub evidence, clearly marked as pending human review.
- **`ctxhub repo add --suggest-globs` / `ctxhub repo discover --suggest-globs`** — inspect a newly added repo and print a suggested per-repo `include`/`exclude` diff for `ctxhub.yaml`, grounded in the repo's layout, without auto-applying it.
- **`ctxhub eval --suggest-queries`** — inspect the current indexed repo/file set and append suggested golden queries plus a short rationale to the eval suite for human review, never replacing curated cases.
- **`ctxhub ask`** — ask a direct question and get an LLM-synthesized, citation-grounded answer from ctxhub’s index. Unlike `explain`, this has no non-LLM answer mode: when unavailable, it tells you to use `explain` or `pack` instead of faking an answer.
- **`ctxhub search --rewrite-query` / MCP `search(rewriteQuery: true)`** — ask the configured agent CLI to rewrite a vague query into a better-scoped query plus result type before searching. When a rewrite happens, ctxhub always surfaces both the original and rewritten values.
- **Index-time file summaries** — for larger multi-chunk files, `llm.enabled` upgrades the synthetic heading/symbol list summary into a short prose summary grounded in the file content itself; disabled or failed LLM calls fall back to the existing non-LLM summary.

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
- `ctxhub onboard`: live terminal setup wizard — init, repo discovery, hooks, memory provider, agents, skills, and an initial index, in one guided flow. Requires a real terminal; use the [manual step-by-step commands](./docs/quickstart.md#manual-step-by-step-equivalent-of-onboard) for non-interactive scripts.
- `ctxhub repo add <name> <path> [--suggest-globs]`: add a repo, validate the path, and detect Git. `--suggest-globs` asks the configured agent CLI for a repo-specific `include`/`exclude` diff without changing config automatically.
- `ctxhub repo list`: print configured repos.
- `ctxhub repo discover [path] [--suggest-globs]`: find Git repositories below a folder. In a real terminal it opens a review screen so you can choose which new repos to add; use `--plain` to auto-add new repos. `--suggest-globs` prints repo-specific `include`/`exclude` diff suggestions for each newly added repo when `llm.enabled`.
- `ctxhub repo hook <name>`: install a `post-commit` Git hook in that repo which re-indexes the workspace in the background after each commit (`-f/--force` to overwrite an existing hook).
- `ctxhub ci init [--with-eval]`: create a GitHub Actions workflow that runs build, `ctxhub validate docs`, and optionally `ctxhub eval` on pull requests.
- `ctxhub index [--notify]`: index changed workspace files. In a real terminal it shows per-repo progress, then prints the durable summary; use `--plain` to force plain progress output. Each file's read/hash/chunk/summarize step runs concurrently (`index.concurrency` in config, default 8; the actual index write always stays sequential for correctness) — a real ~2.4x speedup measured on a 300-file workspace. `--notify` sends a desktop notification when indexing completes.
- `ctxhub sync [--no-pull] [--notify]`: pull configured repos and re-index changed files. In a real terminal it shows separate pull and index progress; `--no-pull` skips the Git pull phase and `--plain` forces plain progress output. `--notify` sends a desktop notification when sync completes.
- `ctxhub search [query] [--rewrite-query]`: search the LanceDB project index. Use `--type all|docs|code|architecture|notes`, or shortcuts like `--code` and `--docs`, when you know what kind of evidence you want. `--rewrite-query` asks the configured agent CLI for a better-scoped query + type first, and surfaces both original and rewritten values when it changes them. In a real terminal it opens live search by default, seeded with the query when provided — type to search-as-you-type, tab cycles result-type facets, arrow keys move, enter views the full chunk, esc goes back/quits. Use `ctxhub search --plain "<query>"` for one-shot output.
- `ctxhub pack <query>`: assemble an agent-ready context pack with search hits, architecture hits, freshness, status, repos, result-type counts, local `rg` follow-up suggestions, and suggested reading order. Add `--out <file>` to save a portable replay artifact.
- `ctxhub explain <query> [--notify] [--as <persona>] [--profile <name>]`: create a citation-first explanation from indexed context without inventing uncited claims — a real LLM-synthesized answer when `llm.enabled` (see [LLM-backed features](#llm-backed-features)), otherwise a non-LLM evidence scaffold. `--llm`/`--no-llm` override the config default for one call. `--as <persona>` frames the answer through a persona from `agents/personas/*.md` (see [docs/personas.md](./docs/personas.md)) — citation discipline is identical with or without one; a persona can't loosen it. `--profile <name>` picks a named `executionProfiles` entry (Phase 4 of the control plane, see [docs/control-plane.md](./docs/control-plane.md)) to choose which harness/model runs this call, and defaults the framing persona from the profile when `--as` isn't given (`--as` always wins for framing if both are set).
- `ctxhub ask <question> [--notify] [--as <persona>]`: answer a question directly from indexed evidence using the configured agent CLI. Unlike `ctxhub explain`, this command does not fall back to a non-LLM scaffold; when disabled or unavailable it tells you to use `ctxhub explain` or `ctxhub pack` instead.
- `ctxhub replay <file>`: replay an exported context pack artifact and compare recorded repo HEADs against the current workspace.
- `ctxhub open <id>`: print a full indexed chunk returned by search or a context pack.
- `ctxhub pr-context [--base origin/main] [--notify]`: build a context pack for files changed on the current branch, with LLM-backed cross-repo contract-risk review when `llm.enabled` (see [LLM-backed features](#llm-backed-features)).
- `ctxhub handoff <topic> [--from-pr] [--notify] [--as <persona>]`: create a Markdown handoff bundle under `.ctxhub/cache/handoffs/` for another agent or teammate, with an LLM-synthesized summary section when `llm.enabled` (see [LLM-backed features](#llm-backed-features)).
- `ctxhub review <topic> --as <persona> [--profiles <path>] [--base origin/main] [--json] [--notify]`: review a topic/change with a named reviewer persona, grounded in the same context-pack/diff/architecture evidence `pr-context`, `graph --drift`, and `handoff` already use — one repeatable, explainable answer to "review this change" instead of remembering which command covers which angle. Personas are data, not code: `--as` looks up a persona by name in `.ctxhub/cache/review-profiles.json` (auto-seeded with the 5 built-ins — `bug-hunter`, `contract`, `security`, `performance`, `docs` — on first run). Add your own by editing that file (or pointing `--profiles` at a different one) with `{ "name": "...", "kind": "generic", "focus": "..." }` — no ctxhub code change needed. `contract`/`docs` are the two `kind`s that reuse existing engines directly (`pr-context`'s risk review, `graph --drift`'s repair suggestions); every other persona is `kind: "generic"`, a freeform LLM prompt over the same diff/context-pack evidence (see [LLM-backed features](#llm-backed-features)). A `review-profiles.json` entry can also set `"persona": "<name>"` to pull in the fuller text of an `agents/personas/*.md` file — a *reviewer profile* (`--as` here) and a *persona* (`--as` on `explain`/`ask`/`handoff`, `agents/personas/*.md`) are related but distinct: the former is review-specific dispatch data, the latter is the portable, cross-command identity/decision-framework doc (see [docs/personas.md](./docs/personas.md)).
- `ctxhub watch [--interval 30] [--detach] [--stop] [--status] [--notify]`: watch workspace files and re-index on change — instantly via real filesystem events (chokidar), with `--interval` as a periodic fallback pass rather than the primary trigger. In a real terminal it shows a live per-repo progress view. `--detach` runs it as a background process (PID file + logs under `.ctxhub/cache/watch.{pid,log}`); check on it with `--status` and stop it with `--stop`. `--notify` sends a desktop notification whenever a cycle actually indexes or deletes something.
- `ctxhub report [-o <path>] [--open] [--memory-query <query>] [--memory-wing <name>] [--memory-room <name>] [--timeline-entity <name>]`: generate a self-contained, browsable HTML report of workspace status, repos, architecture diagrams, MemPalace wing/room summaries when available, optional query-driven memory hits, and the most recently indexed chunks, with a client-side search box, in-page wing/room/timeline-entity filters, a local graph view for repo/file/component/memory relationships (with focus/neighborhood, node-class filters, and clickable edges), and a MemPalace timeline view (no server, no external assets, no LLM call). Every item carries an evidence-backed confidence score (source-type weight, recency, doc/code agreement, corroborating-source count — never a model's own self-rating), shown as a list badge and a full factor breakdown in the graph detail panel. `--open` launches the generated file in your browser.
- `ctxhub memory status`: show MemPalace memory status and LanceDB index status. When MemPalace is configured and available, this also lists discovered wings and rooms so users can reuse them in filtered memory searches. In a real terminal it renders a compact status panel; use `--plain` for script-friendly output.
- `ctxhub memory add <content> [--wing <name>] [--room <name>]`: store durable memory in MemPalace. When `--wing`/`--room` are omitted, they're auto-suggested from existing wings/rooms (best keyword-overlap match, falling back to a `notes` room under the current repo/workspace) so you don't have to already know the exact wing/room to write.
- `ctxhub memory checkpoint [note] --agent <name> [--topic <name>] [--wing <name>]`: save a session-checkpoint diary entry auto-assembled from the current git branch and recent commits, plus an optional free-text note — a lower-friction alternative to `memory diary` for "what was I just doing" checkpoints.
- `ctxhub memory diary <entry> --agent <name> [--wing <name>]`: write a durable diary entry to MemPalace for one agent or user, optionally under a chosen wing.
- `ctxhub memory search <query> [--wing <name>] [--room <name>] [--source-file <path>]`: search MemPalace durable memory, optionally scoped to a wing/project or room.
- `ctxhub memory timeline [entity]`: show MemPalace knowledge-graph timeline events, optionally focused on one entity.
- `ctxhub memory clear`: clear the ctxhub index after confirmation; external MemPalace stores are left to MemPalace.
- `ctxhub doctor [--fix] [--dry-run] [--fix-skills] [--fix-personas] [--fix-agent <name>]`: check Node, Git, config schema version, repo paths, index directory, memory provider, and whether installed skills/agent MCP configs/persona files are stale relative to the currently installed ctxhub version. In a real terminal it renders a live checklist before printing the final lines; use `--plain` for script-friendly output. `--fix` applies safe, low-risk repairs (missing `.ctxhub` directories, default `privacy.redactPatterns`); `--dry-run` previews those changes without writing anything; `--fix-skills`/`--fix-personas`/`--fix-agent <name>` are separate opt-in flags for the more invasive fixes (reinstalling stale skill files, recompiling stale persona files, refreshing an agent's MCP config), since those overwrite files you may have installed deliberately.
- `ctxhub mcp`: start an MCP server (stdio) exposing read-only context tools for AI agents (`--allow-index` adds opt-in mutating index/sync tools; `--allow-memory-write` separately adds opt-in MemPalace write tools). `--central` runs it instead as a Central MCP Gateway (Phase 5 of the control plane, see [docs/control-plane.md](./docs/control-plane.md)): two tools, `list_workspaces` and `call_workspace_tool` (`{ workspace, tool, arguments }`), routing into a named registered workspace's own isolated MCP server -- never merges workspaces into one global search space.
- `ctxhub agent <name>`: write/merge the MCP config for `claude` (`.mcp.json`), `codex` (`.codex/config.toml`), or `copilot` (`~/.copilot/mcp-config.json`) at the discovered workspace root and launch it (`--no-launch` to only write the config). Also wires up MemPalace's own MCP server alongside ctxhub's when configured and available.
- `ctxhub skills install [agents...]`: install chat-native "how to use ctxhub" skills for `claude`, `codex`, `copilot`, and/or `cursor` at the discovered workspace root, then link those files into each configured child repo so repo-root agent sessions can discover them (default: all four).
- `ctxhub personas init`: scaffold a git-tracked `agents/` directory (a starter persona plus an evidence-discipline policy) at the workspace root — safe to re-run, never overwrites files you've edited. See [docs/personas.md](./docs/personas.md).
- `ctxhub personas sync [agents...]`: compile `agents/personas/*.md` per harness — a real native subagent file for all four supported harnesses, each in its own confirmed format: `.claude/agents/<persona>.md` (Claude Code), `.codex/agents/<persona>.toml` (Codex CLI), `.github/agents/<persona>.agent.md` (GitHub Copilot CLI), `.cursor/agents/<persona>.md` (Cursor). See [docs/personas.md](./docs/personas.md) for sources and per-harness verification confidence. Links into configured child repos the same way `skills install` does.
- `ctxhub workspace register [path] [--name <name>]`, `ctxhub workspace list`, `ctxhub workspace remove <name>`: manage a user-level registry of ctxhub workspaces (`~/.ctxhub/registry.json`), Phase 1 of the control-plane vision (see [docs/control-plane.md](./docs/control-plane.md)). Purely a pointer list -- each workspace still owns its own config/index/memory/personas exactly as today. `register` defaults to the discovered workspace root's own configured name; re-registering the same path is a no-op, not an error. `list` flags (but never silently prunes) a workspace whose path no longer exists.
- `ctxhub service start [--foreground] [--port <port>]`, `ctxhub service stop`, `ctxhub service status`: run the local control-plane HTTP service (Phase 2), a detached background process by default (mirrors `ctxhub watch --detach`'s PID-file/log-file pattern, just at user scope). Exposes `GET /health`, `GET /workspaces`, `GET /workspaces/:name/status` (reusing `ctxhub doctor`'s own check functions), and a Fleet-view web page at `GET /` (Phase 3 Mission Control, self-contained HTML/CSS/JS, no CDN, no bundler) on `http://127.0.0.1:7342`. No orchestration or task coordination yet -- see [docs/control-plane.md](./docs/control-plane.md) for what's next.
- `ctxhub captain add <name> --workspace <name> --query "..." [--persona <persona>] [--profile <name>]`, `ctxhub captain list`, `ctxhub captain remove <name>`, `ctxhub captain run <name>`, `ctxhub captain approvals <name>`, `ctxhub captain promote <name> <runId> <repo> [--title <title>] [--agent <agent>]`: define and run Captain tasks (Phase 6 of the control plane, see [docs/control-plane.md](./docs/control-plane.md)) -- plain, editable task config (`~/.ctxhub/captains.json`), each one really just "run `ctxhub explain` unattended against a registered workspace." `run` never writes to a repo; it only ever writes to a non-git-tracked pending-approval queue (`~/.ctxhub/captains/<task>/<runId>.json`). `promote` is the one human-invoked action that turns a pending run into a real, git-tracked AI-draft note (reusing the exact same format `note add --draft` already produces).
- `ctxhub note add <repo> "<title>" [--agent <name>] [--draft]`: scaffold a dated, consistently-formatted note file under `<repo>/agent-notes/` for anything worth a teammate seeing in a PR (see [Two kinds of agent memory](#two-kinds-of-agent-memory)). `--draft` asks the configured agent CLI to write a first draft from recent commits and indexed context when `llm.enabled`.
- `ctxhub note promote <repo> <query> [--wing <name>] [--room <name>] [--hit <index>] [--title <title>] [--agent <name>]`: promote a MemPalace durable-memory hit matching `<query>` into a git-tracked note under `<repo>/agent-notes/`, copied verbatim with a `promoted-from` frontmatter field recording where it came from — the deliberate crossing point from private/session memory into team-shared, reviewable notes.
- `ctxhub diagram add <repo> "<title>" [--agent <name>] [--draft]`: scaffold a dated Mermaid `.mmd` architecture diagram under `<repo>/docs/architecture/` for reviewable team architecture context. `--draft` asks the configured agent CLI to draft Mermaid content from recent commits and indexed context when `llm.enabled`.
- `ctxhub graph [--json|--drift]`: summarize workspace components and relationships from indexed diagrams plus package metadata; `--drift` flags missing or unknown architecture references and `--fail-on-drift` makes those findings CI-failing. With `llm.enabled`, also suggests specific repairs for drift findings (see [LLM-backed features](#llm-backed-features)).
- `ctxhub validate docs [--json|--strict-diagrams]`: check Markdown local links and Mermaid diagram declarations; strict mode adds dependency-light Mermaid delimiter and relationship syntax checks.
- `ctxhub eval [--init|--file <path>|--report|--json|--suggest-queries] [--notify]`: run golden query checks against the index, write run history under `.ctxhub/cache/evals/`, and optionally generate a Markdown quality report. `--suggest-queries` asks the configured agent CLI for additional candidate cases and appends them to the suite with a stored rationale for review.
- `ctxhub eval --agent-report [--file <path>|--json] [--notify]`: check whether an agent reaches for the tool ctxhub's skill docs recommend for a set of realistic questions (requires `llm.enabled`, see [LLM-backed features](#llm-backed-features)).

The default config excludes `.env` files and redacts common secret-looking values before content is written to the index. `privacy.redactPatterns` accepts JavaScript regular expression source strings; matches are replaced with `[REDACTED]`.

`--notify` (on `explain`/`ask`/`pr-context`/`handoff`/`review`/`eval --agent-report`/`--suggest-queries`/`index`/`sync`/`watch`) sends a desktop notification when a command that can take a while — an LLM call, a background watch cycle — actually finishes. It's a thin, best-effort shell-out to the OS's own notifier (`osascript` on macOS, `notify-send` on Linux; a documented no-op on Windows) — no new dependency, the same pattern `ctxhub report --open` already uses to launch a browser.

## MCP server

`ctxhub mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, so MCP-native clients (Claude Desktop, Claude Code, Cursor, etc.) can query the workspace index as structured tools instead of shelling out and parsing terminal output.

The server uses the same upward config discovery as the CLI. If an agent launches it while the current working directory is `my-workspace/some-repo`, ctxhub climbs to `my-workspace/ctxhub.yaml` or `my-workspace/.ctxhub/config.yaml`, then resolves all configured repo/index paths from that workspace root.

Tools exposed:

- `search(query, limit?, type?)` — ranked results plus result-type labels and local `rg` follow-up hints. `type` can be `all`, `docs`, `code`, `architecture`, or `notes`; use `code` when an agent needs exact implementation/symbol starting points before local file reads.
- `context_pack(query, limit?)` — same bundle as `ctxhub pack --json`.
- `open_chunk(id)` — return a full indexed chunk from a search/context-pack result. For TS/JS/JSX files, chunks are already whole top-level functions/classes rather than arbitrary paragraph slices (see [Source-aware context](#source-aware-context) below).
- `get_file_context(repo, path, line?, before?, after?, mode?)` — return context around a line. For TS/JS/JSX files this defaults (`mode: "auto"`) to the full enclosing function/method/class; pass `mode: "lines"` to force the old before/after line window.
- `memory_status()` — same output as `ctxhub memory status`, including MemPalace wing/room summaries when available.
- `memory_search(query, limit?, wing?, room?, source_file?)` — search MemPalace durable memory with optional wing/room/source filters.
- `memory_timeline(entity?)` — read MemPalace knowledge-graph timeline events for one entity or the whole palace.
- `repo_list()` — same output as `ctxhub repo list`.
- `architecture_search(query, limit?)` — search indexed Mermaid diagrams and Mermaid code blocks.
- `architecture_map(query?)` — summarize known components and relationships extracted from indexed diagrams.

These are intentionally read-only by default. Mutating operations stay CLI/human-driven unless explicitly opted into per-surface: `ctxhub mcp --allow-index` adds `index_workspace(force?)` and `sync_workspace(noPull?)`; `ctxhub mcp --allow-memory-write` separately adds `memory_add(content, wing, room, source_file?, added_by?)` and `diary_write(entry, agent_name, topic?, wing?)`, thin passthroughs to `ctxhub memory add`/`diary` (not a second memory implementation — see [ROADMAP.md](./ROADMAP.md)). The two flags are independent: allowing index/sync mutations doesn't also allow writing to durable MemPalace memory, or vice versa. `memory clear` is never exposed over MCP regardless.

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
| How it's written | MemPalace's own MCP tools (`mempalace_add_drawer`, `mempalace_checkpoint`, `mempalace_diary_write`, and 16 others) — wired up automatically by `ctxhub agent <name>` alongside ctxhub's own server, when `memory.provider: mempalace` and MemPalace is installed. For users or agents who want a ctxhub-native wrapper, `ctxhub memory add ... --wing ... --room ...` and `ctxhub memory diary ...` now route into that same durable memory layer. | `ctxhub note add <repo> "<title>" --agent <name>` scaffolds a dated, consistently-formatted stub; the agent fills in the body with its own file-edit tool |
| Visibility | Not shared with the team, not indexed by ctxhub | Shows up in the normal PR diff for review; once merged, ctxhub indexes it like any other doc (it already matches the default `**/*.md` include glob) |

ctxhub doesn't reimplement either of these — MemPalace already has a mature, write-capable MCP surface, and "write a markdown file" is something every agent can already do with its own file tools. ctxhub's job is just making the two paths unambiguous: which one to use, and where the shared one is looked for/indexed.

The crossing point between the two is explicit, not automatic: `ctxhub note promote <repo> <query>` copies one MemPalace hit verbatim into a new team-shared note (with a `promoted-from` field recording where it came from), for when something private/session-scoped turns out to be worth the team seeing. `ctxhub memory checkpoint [note] --agent <name>` stays entirely on the private side — it's a lower-friction `memory diary` for "what was I just doing," auto-assembling the entry from the current git branch/recent commits instead of requiring you to write the whole thing by hand. Neither command blurs the boundary: memory stays memory until you explicitly promote it.

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
