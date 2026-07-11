# ctxhub — Technical Architecture

*The north star for how the system is built. Updated when the architecture changes, not when the strategy does.*

---

## The three layers

```
        AI Models
(Claude, Codex, GPT, Ollama…)
              ▲
       ctxhub Runtime
(Context, Memory, Personas, Index, MCP)
              ▲
      Mission Control
(Fleet, Captains, Missions, Reviews, Analytics)
```

Each layer has a single, clear responsibility. Changes to one layer don't require changes to the others.

**AI Models** — execution engines. Interchangeable. ctxhub is explicitly model-agnostic; a new model arriving or an old one disappearing changes nothing about the architecture.

**ctxhub Runtime** — the context layer. Gives every AI agent a shared, structured understanding of the codebase. Open source.

**Mission Control** — the coordination layer. Gives humans visibility over, and control of, the AI workforce. Commercial.

---

## The runtime in detail

The runtime is everything that runs on the developer's machine. It has no cloud dependency.

### Index

- **Storage:** LanceDB (vector + keyword hybrid search)
- **Input:** source files, documentation, architecture diagrams (Mermaid), agent notes
- **Indexing:** incremental — only changed files are re-indexed
- **Privacy:** redact patterns strip secrets before indexing; index is read-only to agents

### MCP server

- **Transport:** stdio (Model Context Protocol)
- **Tools exposed:**
  - `search` — semantic + keyword search across the workspace
  - `context_pack` — returns a ranked, deduplicated context bundle for a query
  - `open_chunk` — retrieves a specific indexed chunk by ID
  - `architecture_map` — returns the architectural graph for a workspace or repo
  - `file_owners` — returns ownership metadata for a file

### Memory

- **Local:** JSON store in `~/.ctxhub/memory/`
- **External:** MemPalace (optional Python memory service)
- **Scope:** per-agent, per-workspace, or global
- **Access:** read/write via CLI and MCP tools

### EventBus

- **Pattern:** in-process pub/sub singleton
- **Transport:** Server-Sent Events (SSE) from `GET /events`
- **Consumers:** Mission Control dashboard, CLI watchers, webhook triggers

### HTTP service

- **Port:** 7342 (default)
- **Purpose:** REST API for Mission Control, webhook ingress, SSE stream
- **Auth:** webhook token (HMAC); no auth required for localhost-only mode

---

## Mission Control in detail

Mission Control is a React + Vite SPA served by the ctxhub HTTP service at `localhost:7342/dashboard`. It connects to the runtime via REST and SSE.

### Views

| View | Purpose |
|---|---|
| Fleet | Workspace health, live event stream, knowledge graph |
| Captains | Scheduled agent tasks, run history, approval queue |
| Missions | Multi-step agent pipelines, step-by-step execution view |
| Knowledge | Interactive knowledge graph, node detail |
| Review | Persona-driven structured reviews |
| Eval | Index quality dashboard, pass/fail cases |
| Config | Workspace and execution profile management |

### State

- **Server state:** TanStack Query (React Query) — all API calls, caching, invalidation
- **Client state:** Zustand — active view, selected workspace, local UI state
- **Real-time:** SSE stream from `/events`, fan-out into TanStack Query cache invalidations

### Execution profiles

A profile is a named execution context binding:
- Persona (system prompt and reasoning style)
- Provider and model
- Memory scope
- MCP tool permissions

Active profile is stored in config, switchable live from the TopBar without restart.

---

## Data flow

### Indexing

```
File change detected (watch / manual sync)
        ↓
Parser extracts chunks (code, docs, diagrams)
        ↓
Redact patterns applied
        ↓
Embeddings generated (local or API)
        ↓
LanceDB upsert
        ↓
EventBus: index.updated
        ↓
SSE → Mission Control (live progress)
```

### Captain run

```
Schedule fires (or manual trigger / webhook)
        ↓
Captain task loaded from config
        ↓
Execution profile resolved
        ↓
MCP query sent to agent (search → context_pack → explain)
        ↓
Agent response received
        ↓
Result stored in run history
        ↓
EventBus: captain.completed
        ↓
SSE → Mission Control (run appears in queue)
        ↓
Human reviews and promotes (or rejects)
        ↓
Promoted: written to agent-notes/ in repo
```

### Mission run

```
Mission triggered (CLI / Mission Control / webhook)
        ↓
Steps resolved in order
        ↓
For each step:
  - Query interpolated ({prev.answer}, {steps.<name>.answer})
  - Execution profile resolved
  - Agent queried via MCP
  - Answer stored
  - EventBus: mission.step.completed
  - If persist: true → written to MemPalace
        ↓
EventBus: mission.completed
        ↓
SSE → Mission Control (pipeline view updates)
```

---

## Directory structure

```
ctxhub/
├── src/
│   ├── cli/            # Commander CLI entry point
│   ├── commands/       # One file per CLI command group
│   ├── config/         # Config types, load/save, defaults
│   ├── jobs/           # Mission types, store, runner
│   ├── mcp/            # MCP server and tool definitions
│   ├── service/        # HTTP server, routes, SSE
│   ├── store/          # Workspace store, captain store
│   └── utils/          # fs, crypto, text utilities
├── ui/
│   ├── src/
│   │   ├── api/        # TanStack Query hooks, API client
│   │   ├── components/ # React components (one per view)
│   │   ├── lib/        # Utilities (utils, healthColor, relTime)
│   │   ├── store/      # Zustand stores (fleet)
│   │   └── types/      # Shared TypeScript types
│   └── index.html
└── docs/
    ├── architecture.md
    └── quickstart.md
```

---

## Technology choices

| Layer | Technology | Why |
|---|---|---|
| CLI | Node.js + TypeScript + Commander | Type-safe, fast startup, large ecosystem |
| Index | LanceDB | Embedded, no server, vector + keyword hybrid |
| MCP | stdio transport | Universal, works with any MCP-compatible client |
| Dashboard | React + Vite + TanStack Query + Zustand | Fast iteration, mature state management |
| Real-time | Server-Sent Events | Simple, reliable, no WebSocket complexity |
| Memory | Local JSON + MemPalace | Local-first by default, optional external store |

---

## Design constraints

- **Local-first always.** The runtime must function completely offline. Cloud features are additive, never required.
- **Model-agnostic always.** No feature may hardcode a specific model or provider.
- **Read-only index.** Agents read from the index; they never write to it. Findings go to memory or agent-notes.
- **Human approval for promotion.** Nothing goes to the repo without an explicit human action.
- **Incremental everything.** Indexing, context packing, and memory updates should all be incremental to keep large repos fast.
