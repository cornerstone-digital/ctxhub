# Roadmap

*Forward-looking milestones only. For what's already shipped, see [CHANGELOG.md](./CHANGELOG.md). For technical decisions, see the ADRs in [docs/adr/](./docs/adr/). For the full strategic milestone breakdown, see [docs/strategy/MILESTONES.md](./docs/strategy/MILESTONES.md).*

---

## Where we are

The runtime is substantially built. The indexing pipeline, MCP server, CLI, Captains, Missions, Execution Profiles, Personas, and Mission Control are all working. The foundation is solid.

The next phase is making it reliable and delightful enough that people can't imagine working without it.

---

## Milestone 1 — Runtime *(current focus)*

**The promise:** "Install ctxhub. Every AI tool immediately understands my project better than it did yesterday."

### What's left

- [ ] Indexing reliability audit — find and fix failure modes on repos > 50k files
- [ ] MCP tool stability pass — ensure all five tools work correctly across Claude, Codex, and Cursor on macOS and Linux
- [ ] Eval suite — build a representative set of real queries and pass rate target (> 85%)
- [ ] Error messages — every user-facing error should explain what went wrong and how to fix it
- [ ] README rewrite — install → first index → first `ctxhub ask` in under 5 minutes
- [ ] `npm install -g ctxhub` clean install verified on macOS and Ubuntu

### Exit condition

A developer with two repos and two AI tools installs ctxhub, runs `ctxhub index`, and their agents immediately give better answers — without needing to read more than the README.

---

## Milestone 2 — Mission Control *(next)*

**The promise:** "I enjoy opening Mission Control every morning."

### What's left

- [ ] Captain overnight reliability — runs complete without manual recovery
- [ ] Mission end-to-end reliability — multi-step pipelines complete without failure
- [ ] Dashboard performance — no jank on load, no layout shifts
- [ ] Empty states — every empty state tells the user what to do next
- [ ] Screenshots and 90-second demo video
- [ ] Mission replay (basic) — browse past Captain runs in Mission Control

### Exit condition

A developer opens Mission Control, sees what their Captain did overnight, promotes one finding, and closes it — in under two minutes, feeling good about it.

---

## Milestone 3 — Team *(after)*

**The promise:** "Our engineering knowledge survives people leaving."

### What's left

- [ ] Persistent Captain run history (browsable, not just latest)
- [ ] Knowledge Capture Rate metric in Mission Control
- [ ] Execution profile and persona sync across machines (Pro)
- [ ] Structured promoted notes with searchable frontmatter
- [ ] Mission replay — full timeline of all agent activity

### Exit condition

A new engineer on day one can read the last month of Captain findings and promoted ADRs in Mission Control and understand the codebase better than they would have in two months without it.

---

## Later (no commitment, needs user evidence)

- **ctxhub Cloud** — shared Mission Control for teams, RBAC, SSO
- **Marketplace** — installable persona packs and workflow bundles
- **Enterprise** — self-hosted, compliance, custom connectors
- **Cross-workspace intelligence** — queries spanning all workspaces
