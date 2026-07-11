# ctxhub

[![CI](https://github.com/martinegan/ctxhub/actions/workflows/ci.yml/badge.svg)](https://github.com/martinegan/ctxhub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

**Observe. Coordinate. Compound.**

**Make every AI agent understand your codebase.**

AI coding tools solved generation. They didn't solve context. They didn't solve coordination. They didn't solve memory. ctxhub does.

**Every AI interaction leaves your project a little smarter than before.**

ctxhub is the open-source context layer for AI engineering. It gives your entire agent fleet — Claude, Codex, GitHub Copilot, Cursor, local models — a shared, searchable memory of your codebase, schedules agents to work on your behalf, and gives you a live dashboard to watch, control, and act on everything they find.

**Why "ctxhub"?** `ctx` is context. `hub` is where agents, teams, and knowledge meet. Lowercase, one word, because it's a tool — you type it the same way you type `git`.

→ **[Quickstart](./docs/quickstart.md)** · **[Why ctxhub?](./docs/philosophy.md)** · **[Architecture](./docs/architecture.md)** · **[Roadmap](./ROADMAP.md)**

---

![Mission Control](./docs/videos/dashboard-demo.gif)

---

## The loop

Every feature in ctxhub follows the same pattern:

**Observe → Understand → Recommend → Approve → Remember**

Your agents observe the codebase. Captains surface what matters. You review and approve. Promoted findings become institutional knowledge — searchable, compounding, permanent. Features that skip *Approve* don't belong. Features that skip *Remember* don't compound.

---

## Get started

```bash
npm install -g ctxhub
ctxhub onboard
```

`ctxhub onboard` walks you through workspace setup, repo discovery, agent configuration, and your first index. In 60 seconds you'll have:

- ✓ Every agent in your fleet reading from the same indexed context
- ✓ Mission Control running at [http://localhost:7342](http://localhost:7342)
- ✓ Your first Captain scheduled and ready to run overnight
- ✓ Search working across your entire workspace

> **Pre-release:** Until the first stable npm publish, install from source:
> ```bash
> git clone https://github.com/martinegan/ctxhub && cd ctxhub
> npm install && npm run build && npm link
> ```
> Verify your installation: `bash scripts/verify-install.sh`

---

## Why not X?

**Why not just use Cursor / Claude / Copilot?**
They generate code well. They forget everything when the session ends. ctxhub is the memory layer that persists across sessions, across agents, and across teammates — so the context your AI builds today is available tomorrow, to everyone.

**Why not MCP alone?**
MCP solves tool access. ctxhub solves context accumulation. MCP connects agents to tools; ctxhub gives those tools something worth connecting to: a structured, maintained, searchable memory of your codebase.

**Why not Sourcegraph / Cody?**
Sourcegraph indexes code for engineers to search. ctxhub indexes knowledge from AI — not just what exists in the codebase, but what your team has learned about it: findings, decisions, promoted notes, architectural context.

**Why not building it yourself?**
You could wire up MCP, a vector store, a scheduler, a dashboard, and a review workflow. ctxhub is that stack, already assembled, local-first, and open source.

---

## How it works

```
     Mission Control          ← watch, review, promote
           ▲
     ctxhub Runtime           ← index, memory, MCP, personas
           ▲
       AI Models              ← Claude, Codex, Cursor, Ollama
```

**The runtime** indexes your codebase and exposes it to every agent through MCP tools. Agents get shared, structured context instead of grepping repos themselves.

**Mission Control** is the live dashboard where you see what your agents are doing, review what they found, and promote findings into searchable institutional knowledge. Open it with `ctxhub dashboard`.

**The models are interchangeable.** ctxhub works with whatever you already use and doesn't care if that changes.

---

## Mission Control

Mission Control is where everything comes together.

![Fleet view](./docs/images/dashboard-fleet.png)

**Fleet** — every workspace as a live node, coloured by health, with agent activity animated in real time. Click a node to ask it a question; citations link directly to the Knowledge graph.

**Captains** — your overnight AI workforce. Define tasks, review runs, promote findings into git-tracked notes without leaving the browser.

![Captains view](./docs/images/dashboard-captains.png)

**Knowledge** — an Obsidian-style force-directed graph of your indexed workspace. Every file is a node. Click to preview content, expand similarity edges on demand, filter by name.

![Knowledge graph](./docs/images/dashboard-knowledge.png)

**Timeline** — a durable event log of everything that's happened: captain runs, promoted findings, index events. Filter by type, grouped by date.

**Review** — run `ctxhub review --as <persona>` against a real diff without leaving the browser.

---

## MCP server

`ctxhub mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. Point your agent at it once; it reads context from any command inside your workspace.

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

Key tools: `search`, `context_pack`, `get_file_context`, `architecture_search`, `architecture_map`, `memory_search`. Opt-in mutating tools: `index_workspace` (`--allow-index`), `memory_add` (`--allow-memory-write`).

→ **[Full MCP tool reference](./docs/cli.md#mcp-server)**

---

## Common commands

```bash
ctxhub index              # index changed files
ctxhub dashboard          # open Mission Control
ctxhub explain <query>    # evidence-grounded answer
ctxhub captain run <name> # run a Captain task now
ctxhub search <query>     # search the index
ctxhub review <topic> --as <persona>  # AI code review
ctxhub eval --health      # smoke-test the installation
```

→ **[Full CLI reference](./docs/cli.md)**

---

## Key concepts

**Captains** schedule AI agents to run unattended overnight — searching, explaining, surfacing findings — and queue results for your review. Nothing is promoted without your approval.

**Personas** define agent identity and review focus as git-tracked Markdown files, compiled per harness (Claude, Codex, Copilot, Cursor). Team assets, version-controlled, reviewable.

**Execution profiles** bind a persona to a specific model and inference endpoint — local, cloud, or enterprise proxy. One config change to switch models everywhere.

**Knowledge Capture Rate** tracks what fraction of Captain runs produce a promoted finding. It's the metric that shows whether AI work is actually compounding.

→ **[Full concept reference](./docs/architecture.md)**

---

## Privacy

The index excludes `.env` files by default and redacts common secret patterns before writing chunks. Source code never leaves your machine — the index is local, LanceDB is local, and no content is transmitted unless you explicitly configure Cloud sync (a later feature, opt-in).

→ **[Privacy and extension points](./docs/cli.md#privacy)**

---

## Enterprise

ctxhub supports Microsoft Entra ID SSO via `ctxhub auth configure`, giving teams role-based access control (owner, admin, member, reader) mapped from Entra security groups. Corporate Groups let multiple organisations share indexed knowledge with configurable read/bidirectional policies across tenant boundaries. For self-hosted deployment, Docker Compose and Helm charts are provided.

→ **[Self-hosted deployment](./docs/deploy/SELF_HOSTED.md)** · **[Security architecture](./docs/strategy/SECURITY_ARCHITECTURE_BRIEF.md)**

---

## Contributing

Contributions are welcome — code, tests, documentation, Captain tasks, blueprints, and bug reports.

```bash
git clone https://github.com/martinegan/ctxhub
npm install && npm run build && npm test
```

→ **[CONTRIBUTING.md](./CONTRIBUTING.md)** · **[Good first issues](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22)** · **[ADRs](./docs/adr/)**
