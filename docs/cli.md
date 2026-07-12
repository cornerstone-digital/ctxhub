# CLI Reference

Full command reference for ctxhub. For the product overview, see the [README](../README.md). For architecture and concepts, see [architecture.md](./architecture.md).

---

## Contents

- [Setup](#setup)
- [Indexing](#indexing)
- [Search & context](#search--context)
- [Review & analysis](#review--analysis)
- [Memory](#memory)
- [Agents & skills](#agents--skills)
- [Notes & diagrams](#notes--diagrams)
- [Captains](#captains)
- [Service & Mission Control](#service--mission-control)
- [Utilities](#utilities)
- [MCP server](#mcp-server)
- [LLM-backed features](#llm-backed-features)
- [Two kinds of agent memory](#two-kinds-of-agent-memory)
- [Personas](#personas)
- [Execution profiles](#execution-profiles)
- [Skills](#skills)
- [Hooks](#hooks)
- [Privacy](#privacy)
- [Extension points](#extension-points)
- [Config reference](#config-reference)

---

## Setup

| Command | What it does |
|---|---|
| `ctxhub init` | Create workspace config and `.ctxhub/` directories in the current directory. |
| `ctxhub onboard` | Guided wizard: init, repo discovery, hooks, memory provider, agents, skills, and initial index in one flow. Requires a real terminal; for non-interactive scripts use the individual commands. |
| `ctxhub doctor [--fix] [--dry-run]` | Check Node, Git, config schema, repo paths, index, memory provider, and whether installed skills/agent configs are stale. `--fix` applies safe repairs; `--dry-run` previews them. Use `--fix-skills` or `--fix-agent <name>` for the more invasive fixes. |
| `ctxhub ci init [--with-eval]` | Create a GitHub Actions workflow for build, `ctxhub validate docs`, and optionally `ctxhub eval`. |

After any ctxhub upgrade, the next command you run automatically checks for stale skills or agent configs and prints a one-line nudge — once per version, not on every command.

---

## Indexing

| Command | What it does |
|---|---|
| `ctxhub index [--notify]` | Index changed workspace files. Shows per-repo progress in a terminal; `--plain` for script output. Per-file prep runs at `index.concurrency` (default 8); writes are sequential. |
| `ctxhub sync [--no-pull] [--notify]` | Pull repos and re-index changed files. `--no-pull` skips the pull phase. |
| `ctxhub watch [--interval 30] [--detach] [--stop] [--status] [--notify]` | Watch for filesystem changes and re-index on change. `--detach` runs as a background process. |
| `ctxhub repo add <name> <path> [--suggest-globs]` | Add a repo, validate the path, detect Git. `--suggest-globs` asks the configured agent CLI for suggested globs when `llm.enabled`. |
| `ctxhub repo list` | List configured repos. |
| `ctxhub repo discover [path] [--suggest-globs]` | Find Git repos below a folder. In a terminal, opens a review screen to choose which to add; `--plain` auto-adds new repos. |
| `ctxhub repo hook <name>` | Install a `post-commit` Git hook that re-indexes the workspace in the background after each commit. |

---

## Search & context

| Command | What it does |
|---|---|
| `ctxhub search [query] [--rewrite-query]` | Search the index. Use `--type all\|docs\|code\|architecture\|notes` (or `--code`, `--docs` shortcuts). In a terminal, opens live search seeded with the query; `--plain` for one-shot output. |
| `ctxhub pack <query>` | Assemble an agent-ready context pack: search hits, architecture hits, freshness, status, repos, result-type counts, `rg` follow-up suggestions, and suggested reading order. `--out <file>` saves a portable replay artifact. |
| `ctxhub explain <query> [--notify]` | Citation-first explanation grounded in indexed context. With `llm.enabled`: LLM-synthesized answer. Without: evidence scaffold. Never invents a citation. |
| `ctxhub ask <question> [--notify]` | Answer a direct question using the configured agent CLI. No non-LLM fallback — requires `llm.enabled`. |
| `ctxhub open <id>` | Print the full indexed chunk for a search result ID. |
| `ctxhub replay <file>` | Replay an exported context pack and compare recorded repo HEADs against current workspace. |

---

## Review & analysis

| Command | What it does |
|---|---|
| `ctxhub review <topic> --as <persona> [--base origin/main] [--json] [--notify]` | Review a topic using a named reviewer persona, grounded in diff/context-pack/architecture evidence. |
| `ctxhub pr-context [--base origin/main] [--notify]` | Build a context pack for files changed on the current branch, with LLM-backed cross-repo contract-risk review when `llm.enabled`. |
| `ctxhub handoff <topic> [--from-pr] [--notify]` | Create a Markdown handoff bundle in `.ctxhub/cache/handoffs/`. |
| `ctxhub graph [--json\|--drift]` | Summarize workspace components and relationships. `--drift` flags architecture references that are missing or unknown. |
| `ctxhub validate docs [--json\|--strict-diagrams]` | Check Markdown local links and Mermaid diagram declarations. |
| `ctxhub eval [--init\|--file\|--report\|--json\|--suggest-queries] [--notify]` | Run golden query checks against the index. Writes run history to `.ctxhub/cache/evals/`. |
| `ctxhub eval --agent-report [--file\|--json] [--notify]` | Check whether an agent reaches for the tool ctxhub's skill docs recommend for realistic questions. Requires `llm.enabled`. |

**Built-in review personas:**

| Name | Kind | What it reviews |
|---|---|---|
| `bug-hunter` | generic | Likely runtime bugs in the diff |
| `security` | generic | Vulnerability risks |
| `performance` | generic | Performance and efficiency issues |
| `contract` | contract | Cross-repo contract risks |
| `docs` | docs | Architecture drift |

---

## Memory

| Command | What it does |
|---|---|
| `ctxhub memory status` | Show MemPalace and LanceDB index status, including wing/room summaries. |
| `ctxhub memory add <content> [--wing] [--room]` | Store durable memory in MemPalace. Wing/room are auto-suggested from existing rooms when omitted. |
| `ctxhub memory search <query> [--wing] [--room] [--source-file]` | Search MemPalace, optionally scoped to a wing, room, or source file. |
| `ctxhub memory checkpoint [note] --agent <name> [--wing]` | Save a session-checkpoint diary entry. |
| `ctxhub memory diary <entry> --agent <name> [--wing]` | Write a durable diary entry to MemPalace for one agent. |
| `ctxhub memory timeline [entity]` | Show MemPalace knowledge-graph timeline events. |
| `ctxhub memory clear` | Clear the ctxhub index after confirmation. External MemPalace stores are left to MemPalace. |

---

## Agents & skills

| Command | What it does |
|---|---|
| `ctxhub agent <claude\|codex\|copilot>` | Write (or merge) the MCP config for that agent at the workspace root, then launch it. `--no-launch` to only write the config. |
| `ctxhub skills install [agents...]` | Install chat-native skills for `claude`, `codex`, `copilot`, and/or `cursor`. |

**Agent MCP config paths:**

| Agent | Config file | Scope |
|---|---|---|
| `claude` | `.mcp.json` | Project |
| `codex` | `.codex/config.toml` | Project |
| `copilot` | `~/.copilot/mcp-config.json` | User-level |

---

## Notes & diagrams

| Command | What it does |
|---|---|
| `ctxhub note add <repo> "<title>" [--agent] [--draft]` | Scaffold a dated note file in `<repo>/agent-notes/`. |
| `ctxhub note promote <repo> <query> [--wing] [--room] [--hit] [--title] [--agent]` | Promote a MemPalace hit into a git-tracked team note. |
| `ctxhub diagram add <repo> "<title>" [--agent] [--draft]` | Scaffold a dated Mermaid diagram in `<repo>/docs/architecture/`. |

---

## Captains

Captains schedule AI agents to run unattended — searching, explaining, surfacing findings — and queue results for your review. Nothing is promoted without your approval.

| Command | What it does |
|---|---|
| `ctxhub captain add <name> [--workspace] [--query] [--persona] [--profile] [--schedule-every-minutes] [--handoff-to]` | Define a Captain task. |
| `ctxhub captain list` | List defined Captain tasks. |
| `ctxhub captain remove <name>` | Remove a Captain task. |
| `ctxhub captain run <name>` | Run a Captain task immediately. Output goes to a pending-approval queue. |
| `ctxhub captain approvals` | List pending Captain runs awaiting promotion. |
| `ctxhub captain promote <runId> <repo>` | Promote a pending Captain run into a git-tracked note. |
| `ctxhub captain export [--workspace] [--output]` | Export captain task definitions to a portable YAML file. |
| `ctxhub captain import <file> [--workspace] [--overwrite]` | Import captain task definitions from a YAML file. |

---

## Service & Mission Control

| Command | What it does |
|---|---|
| `ctxhub workspace register [path] [--name]` | Register a workspace in `~/.ctxhub/registry.json`. |
| `ctxhub workspace list` | List registered workspaces and their health. |
| `ctxhub workspace remove <name>` | Remove a workspace from the registry. |
| `ctxhub service start [--foreground]` | Start the service on http://127.0.0.1:7342. |
| `ctxhub service stop` | Stop the running service. |
| `ctxhub service status` | Check whether the service is running. |
| `ctxhub dashboard [--port <port>]` | Start the service if not running, then open Mission Control in your browser. |

**Service API endpoints:** `GET /health`, `GET /workspaces`, `GET /workspaces/:name/status`, `GET /events` (SSE), `GET /events/history`, `GET /captains`, `GET /captains/stats`.

---

## Utilities

| Command | What it does |
|---|---|
| `ctxhub report [-o path] [--open]` | Generate a self-contained HTML workspace report: filterable list, knowledge graph, MemPalace timeline. |
| `ctxhub personas init` | Scaffold an `agents/` directory at the workspace root with starter persona and policy files. |
| `ctxhub personas sync` | Compile persona files into per-harness agent config. |
| `ctxhub reset [--global] [--local] [--registry] [--force]` | Clear ctxhub state. `--force` skips confirmation. |
| `ctxhub stats` | Show workspace statistics. |

---

## MCP server

`ctxhub mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio.

**Read-only tools (always available):**

| Tool | Description |
|---|---|
| `search(query, limit?, type?)` | Ranked results with repo, path, type, heading, snippet. |
| `context_pack(query, limit?)` | Full context pack as JSON. |
| `open_chunk(id)` | Full indexed chunk for a search result. |
| `get_file_context(repo, path, line?, before?, after?, mode?)` | Context around a line; defaults to enclosing function/method/class. |
| `architecture_search(query, limit?)` | Search indexed Mermaid diagrams. |
| `architecture_map(query?)` | Components and relationships from indexed diagrams. |
| `repo_list()` | List configured repos. |
| `memory_status()` | MemPalace and index status. |
| `memory_search(query, limit?, wing?, room?, source_file?)` | Search MemPalace durable memory. |
| `memory_timeline(entity?)` | MemPalace knowledge-graph timeline events. |

**Opt-in mutating tools:**

| Flag | Unlocks |
|---|---|
| `ctxhub mcp --allow-index` | `index_workspace(force?)`, `sync_workspace(noPull?)` |
| `ctxhub mcp --allow-memory-write` | `memory_add(content, wing, room, source_file?, added_by?)`, `diary_write(entry, agent_name, topic?, wing?)` |

**Central MCP gateway:** `ctxhub mcp --central` exposes `list_workspaces` and `call_workspace_tool` to route requests across all registered workspaces.

---

## LLM-backed features

Most of ctxhub makes no LLM calls. A subset of features are opt-in:

```yaml
llm:
  enabled: false      # set true to enable
  agent: claude       # auto-detects claude/codex/copilot/cursor on PATH if unset
  timeoutMs: 120000
  # Optional ordered failover through named Execution Profiles. Failures and the winning
  # route are returned with synthesized answers and surfaced in Mission Control Chat.
  fallbackProfiles: [codex-backup, openrouter-backup]

executionProfiles:
  codex-backup:
    runtime: codex
    model: gpt-5.1-codex
  openrouter-backup:
    runtime: direct-api
    model: anthropic/claude-sonnet-4
    gateway:
      baseUrl: https://openrouter.ai/api/v1
      apiKeyEnv: OPENROUTER_API_KEY
```

All LLM-backed features are **off by default** and **evidence-grounded** (built from context packs, diffs, architecture graphs — never free-floating model knowledge). Answer synthesis tries its explicitly configured routes in order, records every attempt, and falls back to the non-LLM evidence scaffold only after the chain is exhausted. An explicitly configured primary agent is never silently replaced unless `fallbackProfiles` opts into that behaviour.

| Feature | Command | Without LLM |
|---|---|---|
| Synthesized answers | `explain`, `ask` | Evidence scaffold (`explain`); error with suggestion (`ask`) |
| Contract-risk review | `pr-context` | Raw diff context pack |
| Drift repair suggestions | `graph --drift` | Drift findings without repair suggestions |
| Handoff summaries | `handoff` | Structured bundle without summary section |
| Persona-framed reviews | `review --as <persona>` (generic kind) | Raw evidence bundle |
| Note/diagram drafts | `note add --draft`, `diagram add --draft` | Empty scaffold |
| Onboarding orientation | `onboard` (final step) | Skipped with notice |
| Query rewriting | `search --rewrite-query` | Original query used unchanged |
| File summaries at index time | `index` (large multi-chunk files) | Synthetic heading/symbol list |
| Repo glob suggestions | `repo add --suggest-globs` | No suggestions |
| Eval quality report | `eval --agent-report` | Not available |
| Golden query expansion | `eval --suggest-queries` | Not available |

---

## Two kinds of agent memory

| | MemPalace | `ctxhub note add` |
|---|---|---|
| **For** | Things worth remembering across your own sessions | Things worth a teammate seeing and reviewing |
| **Where** | `~/.mempalace/` — local, per-user, not git-tracked | `<repo>/agent-notes/<date>-<slug>.md` — git-tracked |
| **Visibility** | Private to you | Shows up in PR diff; indexed once merged |

The crossing point is always explicit: `ctxhub note promote <repo> <query>` copies one MemPalace hit into a new team note, with a `promoted-from` field recording where it came from.

---

## Personas

Personas define agent identity and decision-making as Markdown files in a git-tracked `agents/` directory:

```
agents/
  manifest.yaml
  personas/       → architect.md, implementer.md, reviewer.md…
  skills/         → review.md, debug.md, research.md…
  commands/       → review.md, implement.md, plan.md…
  rooms/          → architecture.md, security.md…
  policies/       → evidence.md, safety.md…
```

`ctxhub personas init` scaffolds the directory. `ctxhub personas sync` compiles personas into per-harness agent files:

| Harness | Output |
|---|---|
| Claude Code | `.claude/agents/<persona>.md` |
| Codex CLI | `.codex/agents/<persona>.toml` |
| GitHub Copilot CLI | `.github/agents/<persona>.agent.md` |
| Cursor | `.cursor/agents/<persona>.md` |

Add custom review personas by editing `.ctxhub/cache/review-profiles.json`:

```json
{ "name": "naming", "kind": "generic", "focus": "Check for consistent naming conventions across the diff." }
```

---

## Execution profiles

Bind a persona to a specific harness, provider, and model in config:

```yaml
executionProfiles:
  architect-primary:
    runtime: claude-code
    model: claude-opus-4
    tags: [premium, trusted, confidential]

  openrouter-economy:
    runtime: direct-api
    gateway:
      baseUrl: https://openrouter.ai/api/v1
      apiKeyEnv: OPENROUTER_API_KEY
    model: openrouter/auto
    tags: [experimental, non-confidential]

  vf3-bedrock:
    runtime: direct-api
    gateway:
      baseUrl: https://bedrock-runtime.eu-west-2.amazonaws.com
    model: eu.anthropic.claude-approved-profile
    tags: [vf3-approved, confidential, enterprise]
```

Use with `ctxhub explain --profile <name>`. The `direct-api` runtime calls any OpenAI-compatible endpoint using Node's built-in `fetch` — no extra dependency.

---

## Skills

`ctxhub skills install [agents...]` installs one focused skill per action:

| Skill | Invocation | What it does |
|---|---|---|
| `ctxhub` | Auto-invoked by agent judgment | Ambient nudge: "the answer might be in a different repo" |
| `ctxhub-search` | `/ctxhub-search <query>` | Explicit on-demand search with typed facets |
| `ctxhub-context` | Explicit | Context-pack gathering for broad cross-repo questions |
| `ctxhub-note` | Explicit | Capture findings as team-shared git-tracked notes |
| `ctxhub-diagram` | Explicit | Capture architecture as a reviewable Mermaid file |

Skill paths per agent:

| Agent | Skill path |
|---|---|
| `claude` | `.claude/skills/<skill>/SKILL.md` |
| `codex` | `.agents/skills/<skill>/SKILL.md` |
| `copilot` | `.github/skills/<skill>/SKILL.md` |
| `cursor` | `.cursor/skills/<skill>/SKILL.md` |

---

## Hooks

```yaml
hooks:
  postPull: "npm --prefix ./app install"
  postIndex: "echo indexed $CTXHUB_WORKSPACE"
```

Both receive `CTXHUB_EVENT` and `CTXHUB_WORKSPACE` env vars. A failing hook prints a warning but does not fail the command.

`ctxhub repo hook <name>` installs a `.git/hooks/post-commit` script that backgrounds a `ctxhub index` run after every local commit.

---

## Privacy

The index excludes `.env` files by default and redacts common secret-like values before writing chunks. `privacy.redactPatterns` accepts JavaScript regex source strings; matches are replaced with `[REDACTED]`.

Source code never leaves your machine. The index is local (LanceDB), memory is local (MemPalace), and no content is transmitted anywhere unless you explicitly configure Cloud sync (a later feature, opt-in per ADR-010).

---

## Extension points

| Layer | Interface | Location |
|---|---|---|
| Index provider | `IndexProvider` | `src/indexing/IndexProvider.ts` |
| Memory adapter | `MemoryAdapter` | `src/memory/MemoryAdapter.ts` |
| Inference gateway | `InferenceGatewayAdapter` | `src/gateway/` |
| Task classifier | `TaskClassifier` | `src/captains/` |

Default implementations: LanceDB (index), MemPalace (memory), OpenAI-compatible (gateway). Local JSON fallbacks available for both index and memory.

---

## Config reference

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
    exclude:
      - "node_modules/**"
      - ".git/**"
      - "dist/**"

memory:
  provider: mempalace          # or local-json
  path: .ctxhub/memory/mempalace

index:
  provider: lancedb            # or local-json
  path: .ctxhub/index/lancedb
  table: ctxhub_chunks
  incremental: true
  chunkSize: 1800
  concurrency: 8

hooks:
  postPull: "npm --prefix ./app install"
  postIndex: "echo indexed $CTXHUB_WORKSPACE"

privacy:
  redactPatterns:
    - "(api[_-]?key|token|secret|password)\\s*[:=]\\s*[^\\s]+"
    - "AKIA[0-9A-Z]{16}"

llm:
  enabled: false
  agent: claude
  timeoutMs: 120000

executionProfiles:
  default:
    runtime: claude-code
    model: claude-sonnet-5
```

Config is discovered by walking upward from the current directory, checking `ctxhub.yaml` then `.ctxhub/config.yaml`. The directory containing the config becomes the workspace root for all paths.
