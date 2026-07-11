# ctxhub

**Make every AI agent understand your codebase.**

---

AI coding tools solved generation.
They didn't solve context.
They didn't solve coordination.
They didn't solve memory.

ctxhub does.

---

## Mission Control

Before anything else — this is what you get.

![Mission Control — Fleet view](./docs/screenshots/mission-control-fleet.png)
*Screenshot placeholder: Mission Control open, Fleet view, live event stream running*

A live command centre for every AI agent working in your codebase. Watch them work. Control what they know. Promote what they find.

Here's what a typical morning looks like in Mission Control:

```
09:02  Git pull detected       frontend — 23 commits since yesterday
09:03  Incremental index       Complete — 31 files updated
09:04  Security Captain        Started
09:05  New dependency found    api-gateway → unreviewed auth library
09:06  ADR drafted             "Adopt or reject: passport-jwt v9"
09:07  Review approved         Martin reviewed and promoted
09:08  GitHub issue created    "Auth dependency review — api-gateway"
09:09  Slack notified          #backend-team
09:10  Knowledge graph         Refreshed — 8 nodes updated
```

Your agents are working. Mission Control shows you everything.

---

## What is ctxhub?

Mission Control is what you see. ctxhub is what runs underneath.

ctxhub gives your entire agent fleet — Claude, Codex, GitHub Copilot, Cursor, local models — a shared, searchable memory of your entire codebase. One index. Every workspace. Every agent.

```
              Mission Control
        ┌──────────────────────────┐
        │   Fleet · Captains · Jobs │
        │   Personas · Eval · Graph │
        └─────────────┬────────────┘
                      │
       ┌──────────────┼──────────────┐
       │              │              │
  Workspace A    Workspace B    Workspace C
       │              │              │
   frontend        api-gateway    terraform
   backend         auth-service   docs
   mobile          sdk            infra
       │              │              │
            Shared Memory + MCP
                    │
       Claude    Codex    Cursor    Ollama
```

This is how companies actually work — multiple repos, multiple agents, one shared understanding. ctxhub is the layer that makes it possible.

No cloud. No SaaS. No data leaving your machine.

---

## Captains — your agents work for you continuously

Stop thinking of AI as something you invoke. With **Captains**, it works for you.

A Captain is a recurring agent query that runs on a schedule, surfaces its findings in Mission Control, and hands results to another Captain when it's done. The AI does the analysis; you make the call.

![Captains view](./docs/screenshots/mission-control-captains.png)
*Screenshot placeholder: Captains view with a completed run, answer lines, and Promote button*

```bash
ctxhub captain add \
  --name nightly-audit \
  --workspace my-workspace \
  --query "What are the highest-risk areas of the codebase right now?" \
  --schedule "0 2 * * *"
```

Results land in an approval queue. Promote what you trust to a git-tracked note in the repo.

**Teams use Captains for:**
- Daily architecture drift review
- Nightly security audit
- "What changed since yesterday — and what should concern me?"
- Weekly dependency health report
- "Explain every PR opened today"

---

## Missions — orchestrate AI agents into engineering workflows

Missions orchestrate multiple AI agents into repeatable engineering workflows.

Each step is an agent call. Steps pass output forward — `{prev.answer}` interpolation means step 2 builds directly on step 1's findings.

```
Audit authentication weaknesses
        ↓
Given those weaknesses, suggest concrete fixes
        ↓
Draft an Architecture Decision Record
        ↓
Create a GitHub issue
        ↓
Notify Slack
```

Watch the pipeline execute in real time in Mission Control. Click any step to see the exact query sent, the answer returned, and the citations behind it.

![Missions view](./docs/screenshots/mission-control-jobs-running.png)
*Screenshot placeholder: Mission pipeline view with step cards, one Running, one Completed*

```bash
ctxhub job add \
  --name security-review-pipeline \
  --step "audit:my-workspace:What are the authentication weaknesses?" \
  --step "remediation:my-workspace:Given {prev.answer}, suggest concrete fixes"

ctxhub job run security-review-pipeline
```

Mark a step `persist: true` and its answer is written to memory automatically — turning mission outputs into searchable institutional knowledge.

---

## Review Personas — your AI review board

Define named review personas and get structured analysis through a specific lens.

| Persona | What they ask |
|---|---|
| **CTO** | "What's the technical debt costing us in velocity?" |
| **Security Engineer** | "What's the attack surface here?" |
| **Performance Engineer** | "Where are the scaling cliffs?" |
| **Staff Engineer** | "What would a new hire find confusing?" |
| **Documentation Reviewer** | "What's undocumented that shouldn't be?" |

> *"Review this feature as our CTO."*
> *"Review this PR as if you're joining the team tomorrow."*

---

## Execution profiles — the right agent for every task

A profile isn't just a model choice. It's a complete execution context: the persona that shapes how the agent reasons, the provider and model it runs on, which memory it reads from, and which tools it has access to.

```yaml
security-review:
  persona: security-engineer      # how it reasons
  provider: claude                # who runs it
  model: claude-opus-4
  memory: security-findings       # what it remembers

implementation:
  persona: senior-typescript
  provider: codex
  model: code-davinci
  memory: architecture-decisions

documentation:
  persona: technical-writer
  provider: gpt-4o
  memory: public-docs

local:
  persona: default
  provider: ollama
  model: llama3
```

Switch the active profile live from the Mission Control TopBar. No config edits. No restarts. This isn't tied to a single model — and it never has to be.

---

## ctxhub remembers

Not chat history.
Institutional knowledge.

Architecture decisions.
Code reviews.
Security findings.
Captain analysis.
Design rationale.

Everything your agents learn becomes searchable — across sessions, across agents, across conversations. Future agents start informed.

---

## The Knowledge Graph — alive, not just visual

The indexed workspace renders as an interactive knowledge graph. But nodes aren't just files — they're living records.

Click any node and see:
- What this service owns
- Which services depend on it
- When it was last indexed
- Open TODOs inside it
- Which Captain flagged it last week

![Knowledge graph](./docs/screenshots/mission-control-knowledge-graph.png)
*Screenshot placeholder: Knowledge graph with three workspace clusters, one node selected with alive detail panel*

---

## You're still in charge

ctxhub augments engineers — it doesn't replace them. Every decision your agents surface goes through you.

```
You
 │
 │  ask a question, define a Captain, or trigger a Mission
 ▼
Mission Control
 │
 │  delegates to the right agent with the right context
 ▼
Agent (Claude / Codex / Cursor / Ollama)
 │
 │  queries the index, reasons, produces findings
 ▼
Approval queue
 │
 │  you review, promote what you trust, reject what you don't
 ▼
Git-tracked note in the repo
```

Agents handle the work that doesn't need a human. You handle the calls that do.

---

## Eval — close the feedback loop

ctxhub has a built-in eval harness for testing whether your index retrieves the right files for real queries. Mission Control surfaces those results as a visual dashboard — pass/fail bars, filterable case list, drill-down into retrieved vs. expected.

When a Captain's answer is wrong, hit 👎 on the run. The query is added to your `eval.json` automatically — no manual test case authoring needed.

![Eval view](./docs/screenshots/mission-control-eval.png)
*Screenshot placeholder: Eval screen with 11/14 pass bar, failing case selected, retrieved vs. expected diff*

---

## Webhook triggers

Every Mission and Captain can be fired from outside ctxhub — from CI, GitHub Actions, or any script.

```bash
ctxhub webhook generate-token

curl -s -X POST \
  http://your-dev-machine:7342/webhooks/${{ secrets.CTXHUB_TOKEN }}/trigger/nightly-audit
```

---

## The CLI

| Area | Commands |
|---|---|
| **Workspace** | `ctxhub init`, `ctxhub repo add/list`, `ctxhub sync`, `ctxhub watch` |
| **Knowledge** | `ctxhub search`, `ctxhub ask`, `ctxhub explain`, `ctxhub graph` |
| **Memory** | `ctxhub memory add/search/timeline` |
| **Automation** | `ctxhub captain add/run/approvals/promote`, `ctxhub job add/run/runs` (Missions), `ctxhub webhook generate-token/show` |
| **Agents** | `ctxhub agent claude/codex/copilot/cursor`, `ctxhub skills install` |
| **Personas** | `ctxhub personas init/sync` |
| **Eval** | `ctxhub eval`, `ctxhub eval --suggest-queries` |
| **Reports** | `ctxhub report` |
| **Service** | `ctxhub service start`, `ctxhub dashboard` |

---

## Built for the way real teams work

- **Local-first.** Nothing leaves your machine. No API keys sent to third parties.
- **Multi-workspace from day one.** Monorepo or polyrepo — ctxhub treats your entire organisation as one searchable workspace.
- **Agent-agnostic.** Claude, Codex, Copilot, Cursor, Ollama — ctxhub writes the right config for each.
- **Incremental indexing.** Only changed files are re-indexed. Large repos stay fast.
- **Privacy controls.** Redact patterns keep secrets out of the index.
- **Fully scriptable.** Every feature has a JSON output mode for CI integration.

---

## Getting started

```bash
npm install -g ctxhub

cd your-project
ctxhub init
ctxhub repo add --name my-app --path .
ctxhub index
ctxhub dashboard
```

→ **[Full quickstart](./docs/quickstart.md)** · **[Architecture docs](./docs/architecture.md)**

---

## The technology

| Layer | Technology |
|---|---|
| CLI | Node.js + TypeScript + Commander |
| Index | LanceDB (vector + keyword) |
| MCP server | stdio, Model Context Protocol |
| Dashboard | React + Vite + TanStack Query + Zustand |
| Memory | MemPalace or local JSON |
| Real-time | Server-Sent Events |

---

*Stop explaining your architecture to every new AI chat.*
