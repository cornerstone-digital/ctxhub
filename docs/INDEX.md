# ctxhub Document Index

*Start here. This map covers every significant document in the repository — what it is, who it's for, and where to go next.*

---

## Layer 1 — Why

Start here to understand what ctxhub is trying to do and why.

| Document | What it answers | Audience |
|---|---|---|
| [README.md](../README.md) | What is ctxhub? How do I install it? | Everyone |
| [PRINCIPLES.md](../PRINCIPLES.md) | What does ctxhub believe? What will it never compromise on? | Contributors, enterprise reviewers |
| [ROADMAP.md](../ROADMAP.md) | Where is ctxhub going, and why in that order? | Contributors, investors, design partners |

---

## Layer 2 — Architecture

Read these to understand how ctxhub is built and why it was built that way.

| Document | What it explains | Audience |
|---|---|---|
| [docs/architecture.md](./architecture.md) | High-level system design — runtime, MCP, Mission Control, agents | Contributors, technical reviewers |
| [docs/cloud_architecture.md](./cloud_architecture.md) | Cloud coordination layer — sync, event model, multi-workspace | Contributors, enterprise reviewers |
| [docs/org_graph.md](./org_graph.md) | Dual-graph model — knowledge graph + org structure | Contributors, enterprise architects |
| [docs/ctxhub_identity_model.docx](./ctxhub_identity_model.docx) | Identity, roles, and RBAC across workspace/org/group/federation | Enterprise architects, security reviewers |
| [docs/trust_model.md](./trust_model.md) | Trust levels, trust grants, trust decay — the conceptual model unifying Mission Control, promotion, knowledge, and governance | Contributors, enterprise architects |
| [docs/architecture/corporate_groups.md](./architecture/corporate_groups.md) | Corporate Groups — multi-entity knowledge sharing within a corporate parent (VodafoneThree model) | Contributors, enterprise architects |
| [src/cloud/README.md](../src/cloud/README.md) | ctxhub Cloud service — architecture, sync protocol, tech stack | Contributors, platform engineers |
| [src/cloud/schema.sql](../src/cloud/schema.sql) | Postgres schema for the Cloud backend (organisations, workspaces, chunks, embeddings, audit log) | Contributors, DBAs |

---

## Layer 3 — Decisions

These are the architectural decisions that shaped the system. Read an ADR to understand *why* a specific choice was made — not just what was chosen.

| ADR | Decision |
|---|---|
| [ADR-001](./adr/ADR-001-event-driven-architecture.md) | Event-driven architecture as the coordination primitive |
| [ADR-002](./adr/ADR-002-lancedb-vector-store.md) | LanceDB as the local vector store |
| [ADR-003](./adr/ADR-003-mcp-protocol.md) | MCP as the agent communication protocol |
| [ADR-004](./adr/ADR-004-local-first.md) | Local-first as the data residency principle |
| [ADR-005](./adr/ADR-005-typescript-runtime.md) | TypeScript for the runtime |
| [ADR-006](./adr/ADR-006-persona-as-markdown.md) | Personas as Markdown files |
| [ADR-007](./adr/ADR-007-captain-architecture.md) | Captain task scheduling and isolation model |
| [ADR-008](./adr/ADR-008-knowledge-graph.md) | Knowledge graph representation |
| [ADR-009](./adr/ADR-009-mission-control-architecture.md) | Mission Control as a local-first dashboard |
| [ADR-010](./adr/ADR-010-source-code-boundary.md) | Source code never transmitted to ctxhub infrastructure |
| [ADR-011](./adr/ADR-011-org-graph-dual-model.md) | Dual-graph: knowledge graph + org structure |
| [ADR-012](./adr/ADR-012-identity-model.md) | Identity model — workspace / org / group / federation |
| [ADR-013](./adr/ADR-013-event-model.md) | Event model as canonical system record |
| [ADR-014](./adr/ADR-014-auth-oidc-pkce.md) | OpenID Connect with PKCE for enterprise authentication |
| [ADR-015](./adr/ADR-015-corporate-groups.md) | Corporate Groups as the multi-entity sharing model |
| [ADR-016](./adr/ADR-016-trust-tiers.md) | Five-tier trust model for knowledge promotion |
| [ADR-017](./adr/ADR-017-cloud-sync.md) | Cloud sync as one-way push of promoted knowledge |

→ **[All ADRs](./adr/)**

---

## Layer 4 — Enterprise

These documents are for enterprise reviewers, procurement teams, and design partners.

| Document | What it covers | Audience |
|---|---|---|
| [docs/strategy/ENTERPRISE_READINESS.md](./strategy/ENTERPRISE_READINESS.md) | Current ✓ / Planned / Roadmap matrix for enterprise capabilities | Procurement, security teams |
| [docs/strategy/SECURITY_ARCHITECTURE_BRIEF.md](./strategy/SECURITY_ARCHITECTURE_BRIEF.md) | Data boundary, identity, secrets handling, UK residency, threat model, threats we don't solve | Security architects, CISOs |
| [docs/strategy/DESIGN_PARTNER_CHARTER.md](./strategy/DESIGN_PARTNER_CHARTER.md) | Founding Design Partner terms, commitments, metrics, Founding Partner Licence | Design partners, CTOs |
| [docs/deploy/SELF_HOSTED.md](./deploy/SELF_HOSTED.md) | Self-hosted deployment guide — Docker, Helm, env vars, Entra ID setup | Platform engineers, DevOps teams |

---

## Layer 5 — Contributing

For engineers who want to contribute to ctxhub.

| Document | What it covers |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, codebase orientation, contribution process, blueprints |
| [docs/cli.md](./cli.md) | Full CLI reference and MCP tool documentation |
| [examples/blueprints/README.md](../examples/blueprints/README.md) | Blueprint format and how to contribute one |

---

## Reading paths

**"I'm an engineer evaluating ctxhub for my team"**
README → PRINCIPLES → docs/architecture.md → docs/trust_model.md → ROADMAP

**"I'm a security or procurement reviewer"**
docs/strategy/ENTERPRISE_READINESS.md → docs/strategy/SECURITY_ARCHITECTURE_BRIEF.md → docs/ctxhub_identity_model.docx → docs/trust_model.md

**"I want to contribute to ctxhub"**
README → CONTRIBUTING.md → docs/architecture.md → docs/adr/ (scan ADRs relevant to your area) → ROADMAP (understand what's being built next)

**"I'm considering a design partner arrangement"**
ROADMAP (Where we are) → docs/strategy/DESIGN_PARTNER_CHARTER.md → docs/strategy/ENTERPRISE_READINESS.md → docs/strategy/SECURITY_ARCHITECTURE_BRIEF.md

**"I want to understand the architecture deeply"**
docs/architecture.md → docs/cloud_architecture.md → docs/org_graph.md → docs/ctxhub_identity_model.docx → docs/trust_model.md → docs/adr/ (all ADRs in order)
