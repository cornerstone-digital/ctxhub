# Quickstart

Two paths, depending on whether you already have a real multi-repo workspace to point ctxhub at.

## Fastest: the reference workspace (no setup)

If you just want to see ctxhub do something before committing to setting up your own workspace,
use the small fictional 3-repo example checked into this repo:

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
things to try against it (confidence scoring, the graph view, review personas).

## Real workspace: the guided wizard

**One-time, per workspace:**

```bash
ctxhub onboard
```

Run this once in the folder containing your multi-repo workspace (a parent directory holding
several git repos, or a single repo). It opens a live terminal wizard, sets up the index, wires up
the MCP server and skills for whichever agents you use, and optionally a git hook to keep the index
fresh.

**Day to day, you mostly don't touch the CLI.** That's the point of the MCP server and skills —
once set up:

- Ask Claude Code, Codex, or Copilot a question about the codebase as normal. The installed
  `ctxhub` skill nudges the agent to check the index first when the answer might live in a
  *different* repo than the one you have open.
- Want a search right now, on demand? `/ctxhub-search <query>` in Claude Code or Codex.
- The index stays current via the `post-commit` hook set up during onboarding, or a manual
  `ctxhub sync`.
- Learned something worth remembering? See
  [Two kinds of agent memory](../README.md#two-kinds-of-agent-memory) — personal/session notes go
  to MemPalace, team-shared notes go through `ctxhub note add`.

**Occasional maintenance:**

- Added a new repo? `ctxhub repo add <name> <path>` (or re-run `ctxhub repo discover`).
- Upgraded ctxhub? Nothing to remember — the next command prints a one-line nudge if a skill or
  agent config is now stale.
- Something feels off? `ctxhub doctor`.

## Manual, step-by-step equivalent of `onboard`

If you'd rather run each piece yourself instead of the wizard:

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

Config is discovered by walking upward from the current directory. At each directory, ctxhub
checks `ctxhub.yaml` first, then `.ctxhub/config.yaml`; the directory containing that config
becomes the workspace root for repo paths, index files, reports, hooks, skills, and MCP agent
config. This means you can run `ctxhub search`, `ctxhub index`, or an agent-launched `ctxhub mcp`
from inside `my-workspace/some-repo/` and it will still use the parent workspace index. `ctxhub
init` is the exception: it intentionally creates a new config in the exact directory where you run
it.

By default, `ctxhub search` uses the LanceDB-backed project index. MemPalace is configured
separately as the durable agent memory layer so Claude/Codex/MCP clients can recall project
decisions and session history without mixing that data into the source/document index.

## Worked example

Inside a Claude Code session at the workspace root or inside any configured child repo, no CLI
commands typed:

> **You**: How does the webhook receiver authenticate before invoking the notifications service?
>
> **Claude**: *(reaches for the `search` MCP tool, since the answer spans two repos)* — reads
> results from `webhooks-service` and `notifications-service`, answers with citations to both.

## Next

- [architecture.md](./architecture.md) for how the pieces underneath actually work.
- The main [README.md](../README.md) for the full command reference and config schema.
