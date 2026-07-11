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

- [x] Indexing reliability audit — `recent()` memory fix, `status()` accurate for large repos, batched deletes, LLM summary timeout
- [x] MCP tool stability pass — 16 tools (12 default + 4 opt-in); `recordUsage` errors swallowed, all handlers wrapped, config-not-found and unknown-repo return actionable guidance
- [x] Eval suite — `ctxhub eval --health` for workspace-agnostic smoke test; `ctxhub eval --init` generates a 5-case starter suite; `--suggest-queries` expands it with LLM-suggested cases
- [x] Error messages — `ctxhub index` validates config before starting, LanceDB load failure explains recovery steps, 0-repo workspace tells user what to do
- [x] README rewrite — done
- [ ] `npm install -g ctxhub` clean install verified on macOS and Ubuntu (Node 22)

### Exit condition

A developer with two repos and two AI tools installs ctxhub, runs `ctxhub index`, and their agents immediately give better answers — without needing to read more than the README.

---

## Milestone 2 — Mission Control *(next)*

**The promise:** "I enjoy opening Mission Control every morning."

### What's left

- [x] Captain overnight reliability — 3-minute outer timeout on explain calls, listCaptainRuns capped at 50 (most-recent), refetchInterval added to useCaptainRuns
- [x] Mission end-to-end reliability — same 3-minute per-step timeout in job runner, steps can no longer hang indefinitely
- [x] Dashboard performance — TaskRuns capped at 20 visible with "show N older" toggle, no unbounded DOM render
- [x] Empty states — ReviewView: no-workspace state with ctxhub init instructions; persona dropdown shows "No review personas configured" instead of permanent "Loading…"
- [ ] Screenshots and 90-second demo video
- [x] Mission replay (basic) — click any Captain run row to expand full detail (answer, citations, llmNotice, flag + promote actions); most-recent-first with collapsible rows

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

Full strategic detail in [docs/strategy/LATER_PHASES.md](./docs/strategy/LATER_PHASES.md).

Each phase has a trigger condition — a specific pattern of user behaviour that has to be visible before building starts. No trigger, no build.

- **ctxhub Cloud** — Mission Control for engineering organisations. Local runtime stays the source of truth; Cloud coordinates. Think Git + GitHub. Trigger: teams coordinating multiple ctxhub instances manually.
- **Blueprint Hub** — installable expertise, not extensions. Persona packs, Captain packs, Mission packs, Industry packs. Full execution contexts, not prompts. Trigger: organic sharing of personas and execution profiles without infrastructure for it.
- **Enterprise** — a deployment, not a product. Mission Control Cloud with RBAC, SSO, SCIM, audit logs, air-gapped option, and compliance documentation (SOC 2, ISO 27001, HIPAA, PCI). Trigger: a real deal that can't close without it.
- **Organisation Graph** — the graph is the product; cross-workspace queries are just one interface to it. Repos, services, APIs, owners, ADRs, Captains, reviews — all connected. Cascade awareness: a change in one workspace triggers Captain runs in others. Trigger: Cloud teams asking "can I query across all our repos?" repeatedly.
- **Engineering Intelligence** — insight from accumulated decisions. Not metrics about process; observations about how an organisation makes decisions over time. Trigger: leaders opening Mission Control for trends, not individual reviews.
