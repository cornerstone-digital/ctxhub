# ctxhub — Project Brief

> Hand this document to a new Claude session to get full context on the project without re-reading the full conversation history.

---

## What ctxhub is today

ctxhub is a published TypeScript CLI (`npm install -g ctxhub`) that acts as a **read-only context and memory server for AI coding agents** working across multi-repo workspaces.

It does three things well today:

1. **Indexes** a workspace (docs, code, architecture diagrams) into LanceDB and exposes a vector search API.
2. **Surfaces context** to agents via an MCP server (`ctxhub mcp`) — tools like `search`, `context_pack`, `open_chunk`, `architecture_search`, `memory_search`.
3. **Organises memory** across two clearly separated layers: private/session memory via MemPalace, and team-shared, git-tracked notes via `ctxhub note add`.

Everything LLM-backed is opt-in (`llm.enabled: false` by default), falls back gracefully when disabled, and shells out to whichever agent CLI the workspace already has configured rather than adding its own API key or SDK dependency.

**Key philosophy constraints** (these should be respected, not quietly worked around):
- Local-first, no mandatory Docker, Python or database — Node.js only.
- Read-only index — never mix agent scratch notes with repo source in the same search results.
- LLM features are evidence-grounded, never free-floating model knowledge.
- Don't reimplement what already exists (MemPalace handles durable memory; harnesses handle execution).

See `docs/philosophy.md` and `docs/architecture.md` in the repo for the full rationale.

---

## Where it's heading (the vision discussed in this conversation)

The next phase evolves ctxhub from a per-workspace CLI into a **local AI control plane** — a background service that orchestrates multiple workspaces, harnesses, personas and providers from a single point of control, without becoming an inference engine itself.

### The big picture

```
User
  ↓
Mission Control  (Electron/web UI)
  ↓
ctxhub Control Plane  (local Node service, no Docker)
  ├─ Workspace Registry
  ├─ Fleet Captain
  ├─ Workspace Captain(s)
  ├─ APS Persona Engine
  ├─ Policy Router
  ├─ Task Coordinator
  ├─ MCP Gateway
  └─ Event Bus
        ↓
Workspace Runtime(s)
        ↓
Harness / API (Claude Code, Codex, OpenRouter, Bedrock…)
```

**ctxhub owns:** orchestration, personas, policies, routing decisions, evidence, approvals, workspace management.  
**External systems own:** inference, model hosting, provider APIs, agent execution.

This keeps ctxhub vendor-neutral and prevents it from becoming a provider-locked inference wrapper.

---

## Key components

### Workspace Registry
A user-level registry of workspaces. Each workspace keeps its own config, index, memory, personas, tasks and policies. Mission Control opens with a Fleet view of all registered workspaces — like a dashboard for your whole AI fleet, not just one project.

### Mission Control (UI)
The proposed desktop/web interface. Planned sections:
- Fleet overview (all workspaces at a glance)
- Workspace canvas
- Captain chat
- Tasks
- Activity feed
- Reviews
- Knowledge graph
- Approvals queue

### Fleet Captain / Workspace Captain
Agents that coordinate work across workspaces (Fleet) or within one workspace (Workspace). Captains route tasks to the right harness + persona, monitor progress, escalate approvals, and surface findings to Mission Control.

### APS — Portable Agent Persona Specification (v2 draft in repo)
Turns personas from provider-specific prompts into reusable, version-controlled engineering assets stored in `.ctxhub/agents/`:

```
.ctxhub/agents/
  manifest.yaml
  personas/     → architect.md, implementer.md, reviewer.md…
  skills/       → review.md, debug.md, research.md…
  commands/     → review.md, implement.md, plan.md…
  rooms/        → architecture.md, security.md…
  policies/     → evidence.md, safety.md…
```

**APS defines behaviour. The configured harness executes it.** Personas are portable across Claude Code, Codex, Cursor, Copilot, Hermes etc.

Execution policy chain: `Persona → Execution Profile → Runtime → Provider → Model`

### Execution Profiles
YAML-defined profiles that bind a persona to a specific harness + provider + model:

```yaml
executionProfiles:
  architect-primary:
    runtime: claude-code
    model: claude-opus-4
    tags: [premium, trusted, confidential]

  openrouter-economy:
    runtime: direct-api
    gateway: openrouter
    model: openrouter/auto
    tags: [experimental, non-confidential, zero-cost]

  vf3-bedrock:
    runtime: direct-api
    gateway: bedrock
    model: eu.anthropic.claude-approved-profile
    credentialRef: { type: aws-profile, profile: vf3-development }
    region: eu-west-2
    tags: [vf3-approved, confidential, enterprise, eu-region]
```

### Central MCP Gateway
One gateway that routes requests into isolated workspace runtimes. Never merges all workspaces into one global index. Exposes a `ctxhub mcp --central` stdio proxy that connects to the local control-plane service.

---

## Gateway / inference strategy

This was the main topic of the ChatGPT conversation. The conclusion:

**ctxhub should not couple itself to any one gateway.** Define a clean `InferenceGatewayAdapter` interface and ship named adapters:

```typescript
interface InferenceGatewayAdapter {
  id: string;
  probe(config: GatewayConfig): Promise<GatewayHealth>;
  execute(request: InferenceRequest, context: ExecutionContext): Promise<InferenceResult>;
  stream?(request: InferenceRequest, context: ExecutionContext): AsyncIterable<InferenceEvent>;
}
```

### Recommended adapters (priority order)

| Adapter | Status | Notes |
|---|---|---|
| Claude Code / Codex harness | Core | Already implemented via `runAgentPrompt()` |
| Generic OpenAI-compatible | Core | Covers LiteLLM, Portkey, Ollama, enterprise proxies via one baseUrl |
| OpenRouter | Core (OSS onboarding) | Free-tier onboarding; best-effort; not for confidential work |
| AWS Bedrock | Core (enterprise) | First-class enterprise adapter; IAM auth; VPC-friendly |
| Anthropic direct | Core | Native Messages API for API-key users |
| LiteLLM | Optional | Self-hosted broad compatibility; no Docker required if run natively |
| Portkey | Optional | Best managed alternative to LiteLLM; composable routing |
| Vercel AI Gateway | Optional | Lowest-friction TypeScript integration |
| Cloudflare AI Gateway | Optional | Good if ctxhub already uses Cloudflare infrastructure |
| vLLM Semantic Router | Optional (later) | Powerful semantic routing for private model fleets; too heavy for MVP |

### Local-first constraint
The control plane must run as a plain Node process — no mandatory Docker:
```
ctxhub service install  # registers launchd/systemd/startup agent
ctxhub service start
ctxhub service stop
```
Endpoints: `http://127.0.0.1:7342` and `ws://127.0.0.1:7342/events`.

### OpenRouter onboarding
```
ctxhub provider add openrouter
# → paste key → validates → creates economy profile
```
Label free-routing clearly as best-effort, not suitable for confidential work.

### Bedrock (enterprise / VF3 pattern)
```yaml
executionPolicy:
  requireTags: [vf3-approved]
  denyGateways: [openrouter]
  allowRegions: [eu-west-2]
  requirePrivateConnectivity: true
```

### vLLM Semantic Router
Interesting but container-heavy today. Borrow its *concepts* (semantic classification, PII detection, model-performance routing) by making `TaskClassifier` pluggable:
```typescript
interface TaskClassifier {
  classify(task: AgentTask): Promise<TaskClassification>;
}
// Implementations: RuleBased → Heuristic → VllmSemanticRouter → LlmBased
```

---

## What's already built (completed backlog items)

All of these are shipped and in the codebase:

- Report-first memory workspace UX
- Memory provenance and backlinks
- Graph interaction and navigation polish
- MCP write-surface parity for durable memory (`--allow-memory-write`)
- Memory workflow automation and promotion paths (`note promote`, `memory checkpoint`)
- Collaborative review mode with built-in reviewer personas (`ctxhub review --as <persona>`)
- Reviewer profiles (custom, pluggable — data not code)
- Harness capability abstraction (`AGENT_CAPABILITIES` table in `src/llm/harness.ts`)
- Evidence-backed confidence scoring (`src/context/confidence.ts`)
- Context compaction (C1 — 47% token reduction measured on VF3 workspace)
- TOON/JSON auto-pick for MCP responses

### Only remaining active queue item
- [ ] OSS adoption kit

---

## Outstanding brainstormed features (not yet built)

From `SUBAGENTS_BRAINSTORM.md` — none of these are scheduled, just ideas:

**A-track (skill-doc guidance only, trivial effort):**
- A1: Fan-out guidance for cross-cutting questions (skill docs only)
- A2: Blast-radius check before finishing a cross-repo change (skill docs only)
- A3: Digest large handoff/PR-context bundles (skill docs only)

**B-track (ctxhub shells out to agent CLI):**
- B2: Formalize `ctxhub eval --agent-report` skill/doc test loop — **highest priority**, already validated by hand
- B3: Architecture drift repair suggestions (`graph --drift` already detects; needs repair suggestions)
- B4: Tailored onboarding for newly added repos
- B5: Cross-repo contract-break PR reviewer
- B6: `ctxhub ask` standalone (may already be partially built)
- B7: Auto-draft note/diagram content on scaffold
- B8: PR/handoff description synthesis
- B9: Eval golden-query expansion
- B10: NL query rewriting
- B11: "Orient me" onboarding narrator

**C-track (context compaction — non-LLM):**
- C2: Token-budget-aware trimming (maxTokens option on search/context_pack)
- C3: De-dupe across context_pack sections
- C4: "Already seen" delta mode (compound savings across a long session)
- C5: Index-time summaries for large files (LLM variant waits on B-track decision)

---

## Next recommended roadmap (control plane build order)

1. Workspace Registry
2. Mission Control UI (Fleet view first)
3. APS engine
4. Central MCP Gateway
5. Fleet Captain / Workspace Captain
6. Execution Profiles
7. OpenRouter + Bedrock adapters
8. LiteLLM / Portkey optional adapters
9. vLLM Semantic Router (pluggable TaskClassifier)

---

## Key files in the repo

| File | Purpose |
|---|---|
| `README.md` | Full command/config reference |
| `docs/philosophy.md` | Design principles and constraints |
| `docs/architecture.md` | How the existing pieces fit together |
| `NEXT_FEATURES.md` | Active implementation backlog |
| `SUBAGENTS_BRAINSTORM.md` | Sub-agent and compaction ideas |
| `ROADMAP.md` | What's shipped, planned, and explicitly out of scope |
| `Portable-Agent-Persona-Specification-v2.md` | APS draft spec |
| `ctxhub-AI-Control-Plane-Recommendations.md` | Gateway strategy summary |
| `deep-research-report.md` | Competitive analysis (ChatGPT-authored) |
| `src/llm/harness.ts` | `AGENT_CAPABILITIES` — single source of truth for harness support |
| `src/mcp/server.ts` | MCP server; all responses pass through `textResult()` + compaction |
| `src/context/confidence.ts` | Evidence-backed confidence scoring (no LLM) |
| `src/commands/review.ts` | Reviewer persona dispatch |

---

## Immediate open questions (not yet resolved)

1. **Architecture vNext document** — the suggestion was to consolidate all these scattered brainstorm/spec files into one coherent 50–100 page design document covering every layer of the platform. Worth doing before the control plane build starts, so contributors have one source of truth.

2. **Where does APS live?** It currently sits as a standalone spec file. It needs to become either a sub-package of ctxhub or a separate repo with its own versioning.

3. **Mission Control tech stack** — not decided yet. Electron vs web-based, React vs something else.

4. **B-track decision** — does ctxhub shell out to agent CLIs for its own inference, or does it stay purely a read/route/orchestrate layer? The `llm.enabled` flag already makes this opt-in, but the control plane era makes the question more pressing.

5. **VF3 / enterprise client model** — workspace policies, IAM integration, private connectivity requirements. Bedrock is the clear recommendation but the integration detail isn't designed yet.
