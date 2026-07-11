# ctxhub Milestones

*Milestone-based, not date-based. Each milestone has a clear exit condition. Don't move to the next until the current one is genuinely done. For the detailed engineering changelog, see ROADMAP.md.*

---

## How to read this

Each milestone has one promise — a sentence a real user would say if the milestone is complete. Features exist to make that sentence true, not as goals in themselves.

---

## Milestone 1 — Runtime

**The promise:** "Install ctxhub. Every AI tool immediately understands my project better than it did yesterday."

This is the only thing that matters right now. Nothing in Milestone 2 or 3 is worth prioritising until this is reliably true.

### Exit condition

A developer with two or more repos, using two or more AI tools, installs ctxhub, runs `ctxhub index`, and their agents immediately produce better, more contextually accurate answers — without any configuration beyond pointing ctxhub at their workspace.

### Quality bar

- [ ] Incremental indexing is reliable and fast on repos up to 100k files
- [ ] All five MCP tools work reliably with Claude, Codex, and Cursor
- [ ] Eval harness passes on a representative suite of real queries
- [ ] No known data loss or corruption bugs
- [ ] Error messages are clear enough that a developer can fix them without reading source code
- [ ] README accurately describes what the tool does and how to install it

### What doesn't ship yet

Team features, cloud sync, Mission history / replay, RBAC or enterprise auth.

---

## Milestone 2 — Mission Control

**The promise:** "I enjoy opening Mission Control every morning."

Habit is the goal, not features. A dashboard nobody opens isn't a dashboard — it's a liability. Every decision in this milestone should be tested against one question: does this make Mission Control more useful to open daily?

### Exit condition

A developer opens Mission Control first thing in the morning, sees what their agents did overnight, promotes one Captain finding, and closes it. The whole flow takes under two minutes and feels good.

### Quality bar

- [ ] Captain runs complete reliably overnight without manual intervention
- [ ] Promote flow writes a clean, readable note to the repo
- [ ] Multi-step Mission executes end-to-end without manual recovery
- [ ] The dashboard feels fast — no jank on load, no layout shifts
- [ ] Empty states tell the user what to do next, not just "nothing here"
- [ ] 👎 feedback on Captain runs correctly adds the query to eval.json

### What doesn't ship yet

Mission replay, team dashboards, notifications, analytics.

---

## Milestone 3 — Team

**The promise:** "Our engineering knowledge survives people leaving."

This is where the company starts. A solo developer using ctxhub has a better experience. An engineering team using ctxhub builds a durable asset. The team milestone is about making the institutional knowledge visible and persistent enough that it outlasts any individual.

### Exit condition

A new engineer joins a team using ctxhub. On day one, they run a few searches, open Mission Control, and read through the last month of Captain findings and promoted ADRs. By the end of their first week they have a richer understanding of the architecture than they would have reached in two months without ctxhub.

### Quality bar

- [ ] Promoted notes are structured, searchable, and linked to the code that generated them
- [ ] Captain run history is persistent and browsable (not just the latest run)
- [ ] Mission replay — any Captain run or Mission from the past can be replayed in Mission Control
- [ ] Knowledge Capture Rate is displayed in Mission Control and accurate
- [ ] Personas, execution profiles, and Captain definitions sync across machines (Pro)

### What doesn't ship yet

RBAC / SSO, shared team Mission Control workspace (multi-user), enterprise audit logs, marketplace.

---

## Beyond Milestone 3

These exist as concepts, not commitments. They get evaluated when Milestone 3 is done and there's user evidence to inform the decision.

- **ctxhub Cloud** — shared Mission Control workspace for teams, RBAC, SSO, audit logs
- **Marketplace** — installable persona packs and workflow bundles from the community
- **Enterprise** — self-hosted, on-premises, compliance, custom connectors, SLA
- **Cross-workspace intelligence** — queries spanning multiple workspaces

---

## The filter

Before adding anything to a milestone, check it against the principles:

1. Does it create open context?
2. Does it increase human control and trust?
3. Does it compound engineering knowledge?

If the answer to all three is no, it doesn't belong here yet.
