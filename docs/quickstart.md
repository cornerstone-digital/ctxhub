# Quickstart

ctxhub works with a single repo, a monorepo, or a parent directory holding several repos. Pick the
path that matches your situation.

**What you'll have at the end:**

```
your-repo/
  ctxhub.yaml          ← workspace config
  .ctxhub/
    index/             ← LanceDB search index
    cache/             ← evals, handoffs, health data
    memory/            ← MemPalace durable memory
  .mcp.json            ← agent MCP config (claude)
  .claude/skills/      ← installed skills
```

## Fastest: the reference workspace (no setup)

If you just want to see ctxhub working before setting up your own repo, use the small 3-repo
example bundled with this repo:

```bash
git clone <this-repo>
cd ctxhub
npm install && npm run build && npm link
cd examples/reference-workspace
ctxhub index
ctxhub search "authentication flow"
ctxhub graph
ctxhub report --open
```

See [examples/reference-workspace/README.md](../examples/reference-workspace/README.md) for more
things to try.

## Single repo (most common starting point)

If you have one git repo and want to add ctxhub to it:

```bash
cd /path/to/your-repo

# 1. Register with the control plane (needed for Mission Control UI)
ctxhub workspace register . --name my-project

# 2. Tell ctxhub which code to index
ctxhub repo add my-project .

# 3. Build the index
ctxhub index

# 4. Verify everything looks healthy
ctxhub doctor

# 5. Wire up your agent (Claude, Codex, etc.)
ctxhub agent claude
ctxhub skills install
```

That's it. The index is now searchable via MCP and the Mission Control dashboard. To keep the index
fresh automatically, add a post-commit hook:

```bash
ctxhub sync --hook
```

**The key step people miss:** `ctxhub repo add` must come before `ctxhub index`. Registering a
workspace (`workspace register`) tells the control plane the workspace exists; adding a repo
(`repo add`) tells the indexer what code to actually scan.

## Multi-repo or monorepo

If your workspace is a parent directory containing several git repos:

```bash
cd /path/to/workspace        # parent directory, not inside any single repo

ctxhub workspace register . --name my-workspace
ctxhub repo discover ./      # auto-detects git repos in subdirectories
ctxhub repo list             # verify what was found
ctxhub index
ctxhub doctor
ctxhub agent claude
ctxhub skills install
```

Or add repos manually if you want fine-grained control:

```bash
ctxhub repo add api      ./api
ctxhub repo add frontend ./frontend
ctxhub repo add infra    ./infra
ctxhub index
```

## Guided wizard (does all of the above interactively)

If you'd rather be walked through setup step by step:

```bash
cd /path/to/your-repo-or-workspace
ctxhub onboard
```

## Mission Control

To open the dashboard showing all registered workspaces and their health:

```bash
ctxhub service start
open http://localhost:7342
```

## Day to day

**You mostly don't touch the CLI after setup.** That's the point of the MCP server and skills.

| Situation | What to do |
|---|---|
| Ask a question about your code | Just ask Claude/Codex — the `ctxhub` skill makes it check the index |
| Explicit search right now | `/ctxhub-search <query>` in Claude Code or Codex |
| Index feels stale | `ctxhub sync` (or auto via `post-commit` hook) |
| Added a new repo | `ctxhub repo add <name> <path>` then `ctxhub index` |
| Worth remembering personally | `ctxhub memory add "..."` → MemPalace |
| Worth the team seeing | `ctxhub note add <repo> "<title>"` → git-tracked note |
| Something feels off | `ctxhub doctor` |
| Upgraded ctxhub | Nothing — the next command auto-nudges if skills or config are stale |

See [Two kinds of agent memory](../README.md#two-kinds-of-agent-memory) for the full picture on
MemPalace vs. team notes.

## How config discovery works

ctxhub walks upward from the current directory looking for `ctxhub.yaml` or `.ctxhub/config.yaml`.
The directory containing that file becomes the workspace root. This means you can run
`ctxhub search` or `ctxhub index` from inside any subdirectory and it will find the right workspace
config. `ctxhub init` is the exception — it always creates a new config in the exact directory
where you run it.

## Worked example

Inside a Claude Code session, no CLI commands typed:

> **You**: How does the webhook receiver authenticate before invoking the notifications service?
>
> **Claude**: *(uses the `search` MCP tool)* — reads results from `webhooks-service` and
> `notifications-service`, answers with citations to both.

## Next

- [architecture.md](./architecture.md) — how the pieces underneath work.
- [README.md](../README.md) — full command reference and config schema.
