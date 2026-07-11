# Later Phases — Strategic Direction

*Internal document. Not for public distribution.*

*These phases have no committed ship dates. Each depends on evidence from the previous one — user behaviour, retention signals, and willingness to pay. The mission doesn't change. The scope expands.*

---

## The progression

Every phase is the same north star at a larger scale.

| Phase | Who it serves | North star expression | Monday morning |
|---|---|---|---|
| **Runtime** | Individual developer | Every AI understands your project. | Claude knows your code. |
| **Mission Control** | Individual developer | Humans coordinate their AI workforce. | You review what your Captains found overnight. |
| **Cloud** | Engineering team | Teams coordinate engineering knowledge. | You see what your entire engineering organisation discovered overnight. |
| **Organisation Graph** | Engineering organisation | Organisations reason across all their software. | You ask one question and get an answer spanning fifty repositories. |
| **Engineering Intelligence** | Engineering leadership | ctxhub helps organisations continuously improve how they engineer. | Mission Control tells you what changed this month before you even know what to ask. |

The mission — *turn every engineering decision into institutional knowledge* — doesn't change at any stage. What changes is the unit: one developer's project → one team's knowledge → one organisation's collective intelligence.

---

## Phase 4 — ctxhub Cloud

**Framing: Shared engineering consciousness.**

Not "hosted ctxhub." That's not interesting, and it's not what teams actually need. The local runtime is already the right place to index code — it runs where the code lives, costs nothing to operate, and keeps data on premises by default. Cloud doesn't replace that.

Cloud coordinates. More precisely: Cloud creates awareness.

Think Git and GitHub. Git runs locally, owns the source of truth, never needs a server. GitHub adds the coordination layer: visibility, collaboration, shared state. ctxhub Cloud follows the same model — but the thing being coordinated isn't code commits, it's engineering knowledge.

The difference between sync and awareness matters. Sync is "your persona is now available on both machines." Awareness is:

```
Martin promoted an ADR
  ↓
Security Captain reran automatically
  ↓
Payments workspace updated its findings
  ↓
Another team's Captain references the new pattern
  ↓
Platform team notified: architecture constraint changed
```

That's not syncing state. That's an organisation becoming aware of itself.

```
          ctxhub Cloud
    Shared Mission Control
              │
 ┌────────────┼────────────┐
 │            │            │
 Workspace A  Workspace B  Workspace C
 │            │            │
 Local        Local        Local
 Runtime      Runtime      Runtime
```

The runtime indexes locally. Mission Control Cloud coordinates everything. Cloud doesn't own the index. It owns the coordination.

### What ships

**Team Fleet**

Every workspace visible in one view: who's indexing, who's running Captains, health status, version, current branch, active agent count. The engineering manager's equivalent of a deployment dashboard — not for the code, for the AI workforce.

**Shared Mission Control**

"My Captain" becomes "Our Captains." Captains assigned to team-level responsibilities: Security Captain, Architecture Captain, Dependency Captain, Compliance Captain — running continuously across the whole codebase portfolio, surfacing findings to a shared queue.

**Shared Approval Queue**

```
Pending
  ✓ Security review — authentication service
  ✓ ADR promotion — caching strategy
  ✓ Architecture drift — three services
  ✓ New knowledge — payment flow refactor
```

Same mental model as a GitHub PR review queue. Engineers already know how to work this way. Mission Control makes the AI workforce's output look like PRs waiting for review — because that's exactly what it is.

**Team Knowledge Graph**

Not just files. The organisational graph:

- People → owns what
- Services → depends on what
- Repositories → relates to what
- ADRs → conflicts with what
- Captains → found what
- Reviews → approved what

When an engineer asks "who owns the authentication service?", the answer includes the person, the repos, the Captain findings, the last ADR, and the open reviews. Knowledge becomes organisational.

**Sync**

Personas, execution profiles, Captains, policies, and mission blueprints synchronised across a team. When the principal architect updates the security persona, every workspace gets it.

**Notifications**

Captain findings, pending approvals, and drift alerts delivered to Slack, Teams, email, or GitHub. The AI workforce reports to where the humans already work.

**Organisation Metrics**

- Knowledge Capture Rate (team-wide)
- Captain health across all workspaces
- Knowledge growth rate
- Review latency (time to approve/reject a finding)
- Architecture drift (repos diverging from agreed patterns)
- AI trust score (% of Captain findings promoted vs rejected, trending)

### The trigger for building this

Evidence that small teams are running multiple ctxhub instances separately and coordinating manually. They're sharing personas via git, comparing Captain findings in Slack, duplicating execution profiles across repos. When that pattern is visible in a handful of teams, Cloud becomes the obvious thing to build.

---

## Phase 5 — Blueprint Hub

**Not Marketplace. Marketplace makes people think VS Code extensions. This is different.**

A VS Code extension is a piece of software. A Blueprint is expertise — a complete execution context that encodes how a specific type of engineer thinks, what they look for, and how they work. The distinction matters because it shapes what gets published, how it's priced, and why people trust it.

```bash
ctxhub install fintech-review-pack
ctxhub install aws-principal-architect
ctxhub install kubernetes-security
ctxhub install pci-compliance-pack
```

### What a Blueprint is

A Blueprint isn't a prompt. It's a complete execution context:

- System prompt and reasoning style
- MCP tool permissions
- Model and provider binding
- Memory room scope
- Approval rules and promotion thresholds
- Relevant skills and Captain configurations

Installable, shareable, versionable. When you install the `aws-principal-architect` Blueprint, you get an agent that thinks the way a senior AWS architect thinks — not because someone wrote a prompt that says "act like a senior AWS architect," but because someone encoded their actual review patterns, their real approval criteria, their specific set of tools and memory scopes.

### Blueprint types

**Personas** — specialist reviewers:
- Principal Architect
- AWS Specialist
- Kubernetes Reviewer
- Accessibility Expert
- PCI DSS Reviewer
- GDPR Compliance Officer

**Captain Packs** — ongoing monitoring responsibilities:
- Security Patrol
- Dependency Guardian
- Documentation Curator
- ADR Generator
- Performance Regression Watcher

**Mission Packs** — coordinated one-off workflows:
- Weekly Architecture Review
- Release Readiness Audit
- Onboarding Audit
- Incident Post-mortem

**Knowledge Packs** — domain-specific context and patterns:
- Domain-Driven Design
- AWS Well-Architected
- Terraform Best Practices
- Kubernetes Patterns
- Next.js Conventions

**Industry Packs** — compliance and sector-specific patterns:
- FinTech (PCI DSS, open banking)
- Healthcare (HIPAA, HL7)
- Gaming (performance, telemetry)
- Insurance (audit, actuarial)

**Team Blueprints** — complete engineering operating models:

```bash
ctxhub install startup-team
ctxhub install platform-team
ctxhub install fintech-team
```

A Team Blueprint installs everything needed to run a specific kind of engineering team: personas, Captains, policies, review templates, mission packs, knowledge packs, and approval rules — all pre-wired for a specific context. Not "here are some useful agents," but "here is how this type of team operates, encoded as a ctxhub configuration."

This is the highest-leverage thing Blueprint Hub can ship. An engineering director at a new company shouldn't have to design their AI governance model from scratch. Someone has already solved it. Team Blueprints make that solution installable.

### Trust tiers

- **Community** — published by anyone, unverified, use with judgement
- **Curated** — reviewed by ctxhub, quality bar confirmed
- **Enterprise-verified** — audited, compliance-documented, suitable for regulated environments

### The trigger for building this

Evidence that teams are sharing personas and execution profiles informally — via git, Slack, direct file transfer. When there's organic sharing happening without infrastructure for it, Blueprint Hub is the infrastructure.

---

## Phase 6 — Enterprise

**Enterprise is a deployment, not a product.**

The feature set is Mission Control Cloud. What changes is where it runs, who controls it, and what governance requirements it has to satisfy. Enterprise customers aren't buying different software — they're buying the right to run it entirely on their own infrastructure with the compliance properties their legal and security teams require.

### Security

- Role-based access control (RBAC)
- Single sign-on (SSO) — SAML 2.0, OIDC
- SCIM provisioning
- Audit logs (who approved what, when, from where)
- Encryption at rest and in transit
- Air-gapped deployment (no external calls)
- Private networking

### Compliance

- SOC 2 Type II
- ISO 27001
- GDPR (data residency, right to deletion)
- PCI DSS
- HIPAA
- Retention policies
- Legal hold

### Governance

- Approval policies (who can approve what category of finding)
- Protected personas (org-mandated, not overridable by individuals)
- Allowed model list (only approved providers can be used)
- Allowed MCP list (only approved tools can be invoked)
- Approved gateway configurations

### Integrations

Where engineering knowledge already lives and where findings need to go:

- GitHub, GitLab, Azure DevOps (code)
- Jira, Linear (issue tracking)
- Confluence, Notion (documentation)
- Slack, Teams (notifications)
- Datadog, Dynatrace, PagerDuty (observability)
- ServiceNow (ITSM)
- Backstage (developer portal)
- AWS, Azure, GCP (cloud infrastructure)

### Deployment options

- Docker Compose (single host)
- Kubernetes (Helm chart)
- VM / bare metal
- Air-gapped (no egress)

### The trigger for building this

An inbound request from a company that cannot use Cloud because of their data residency or security requirements, but wants to. Not hypothetical demand — a real deal that can't close without it.

---

## Phase 7 — Organisation Graph

**The graph is the product. Cross-workspace queries are just what you ask it.**

Today, a developer asking "where is authentication implemented?" searches one repo. The Organisation Graph answers across all of them:

```
Where is authentication implemented?

  frontend (3 files)
    └─ AuthProvider, useAuth hook, token refresh
  api-gateway (2 files)
    └─ JWT validation middleware, rate limiting by identity
  identity-service (8 files)
    └─ OAuth2 server, PKCE flow, session management
  shared-sdk (1 file)
    └─ AuthClient (used by 4 other services)
  terraform (3 files)
    └─ Cognito config, IAM roles, KMS keys
  documentation
    └─ ADR-017: auth strategy, ADR-031: session expiry
  security reviews
    └─ 3 findings (2 resolved, 1 open)
  owners
    └─ identity-team (primary), platform-team (sdk)
  Captain findings
    └─ Token rotation gap identified 2024-03 (resolved)
```

That's not search. That's organisational intelligence.

### What the graph models

The local index models: `repo → file → chunk`. The Organisation Graph models the relationships that sit above code:

```
Organisation
  └─ Workspaces (repositories, teams, domains)
       └─ Components (services, libraries, APIs, schemas)
            └─ Relationships (depends on, exposes, owns, conflicts with)
                 └─ Knowledge (ADRs, Captain findings, reviews, decisions)
                      └─ Ownership (teams, engineers, Captains)
```

Cross-workspace queries are one interface to the graph. Cascade awareness (a change in one workspace triggering Captain runs in others) is another. Engineering Intelligence is a third. The graph is the substrate; everything else runs on top of it.

### Organisation-level questions

- Show me every implementation of OAuth across our services.
- Where do we still use JWT v1?
- Which repos still depend on the deprecated payments-sdk?
- What will break if I remove this endpoint?
- Show me duplicated business logic.
- Show me conflicting ADRs.
- Show me all places where payment processing happens.
- Find every place GDPR data handling is discussed.
- Which repos have architecture drift from our agreed patterns?
- Which repos have never had a security Captain run?
- Who owns this component? Which teams depend on it?
- Which services share a database?

### Why building the graph is hard

Cross-workspace intelligence isn't just "run search against multiple indexes." The hard part is:

1. **Identity resolution** — the same service is called "payments-service", "payment-svc", and "paysvc" across different repos
2. **Schema alignment** — each workspace's graph uses local naming conventions
3. **Conflict detection** — ADR-012 in workspace A conflicts with ADR-008 in workspace B; finding that requires understanding both
4. **Provenance** — when an answer spans 4 repos, every cited piece of evidence needs attribution

That complexity is also the moat. Building a local index is tractable. Building an organisation graph that resolves identity, detects conflicts, and maintains provenance — that takes years of accumulated query patterns and feedback loops.

### The trigger for building this

Teams already using Cloud who ask "can I query across all our repos?" before it's possible. When that question appears repeatedly in support channels and user conversations, the evidence is there.

---

## Phase 8 — Engineering Intelligence

**This is where accumulated knowledge becomes insight.**

Not search. Not coordination. Observation.

After months of Captain runs, review approvals, ADR promotions, and mission outputs, Mission Control has something no other tool has: a longitudinal record of how an engineering organisation makes decisions over time.

Engineering Intelligence is what you build on top of that record.

### What it looks like

Mission Control surfaces patterns the organisation couldn't see before:

```
Architecture Intelligence — this quarter

  Your architecture is becoming more modular.
  Service coupling has decreased 34% since January.

  Payments has become a bottleneck.
  12 of the last 15 cross-service ADRs reference it.

  Three teams independently solved the same caching problem.
  payment-service, notifications, and search all built custom
  TTL logic. Consolidation opportunity identified.

  ADR-017 (auth strategy) is being violated.
  4 new services authenticate with the deprecated pattern.
  Captain finding: 3 flagged, 1 missed.

  Onboarding time is improving.
  Time-to-first-meaningful-PR has fallen from 19 days to 8
  days over the last 6 months.
```

These aren't alerts. They're observations — the kind an experienced engineering director would make after reviewing months of work, now surfaced automatically.

### The insight types

**Architectural observations** — how the system is evolving:
- Coupling trends, cohesion trends, dependency evolution
- Violation patterns (which ADRs are being ignored)
- Duplication and consolidation opportunities

**Organisational observations** — how the team is working:
- Knowledge distribution (who knows what, how concentrated is it)
- Review latency trends
- AI trust score evolution across teams and Captains

**Risk observations** — what needs attention:
- Single points of failure (technical and knowledge)
- Engineers with disproportionate knowledge concentration
- Services with no recent review
- Architecture drift by team

**Improvement observations** — what's working:
- Teams with high knowledge capture rate
- Captains with high promotion rates
- Patterns worth propagating

### Why this matters

Every other engineering intelligence tool works from metrics (deploys per day, PR cycle time, test coverage). Those are signals about the process. Engineering Intelligence works from *decisions* — what was built, why, who approved it, what the AI found. That's a fundamentally different signal.

An organisation that has been running ctxhub for two years has a decision record that no other tool can reconstruct. Engineering Intelligence is what makes that record legible to leadership.

### The trigger for building this

Evidence that engineering leaders — VPs, CTOs, principal engineers — are opening Mission Control to review trends rather than just individual reviews. When the use case shifts from "review this finding" to "show me what's changing," Engineering Intelligence is the product.

---

## What not to build at each stage

**Cloud** — don't build a hosted version of the local runtime. The index stays local. Cloud coordinates, it doesn't own.

**Blueprint Hub** — don't build a prompt repository. A prompt is not a Blueprint. If it doesn't include execution context (model, tools, memory scope, approval rules), it's not worth publishing.

**Enterprise** — don't build a separate product. Enterprise is deployment flexibility and compliance documentation on top of Mission Control Cloud, not a different feature set.

**Organisation Graph** — don't build "search across repos." That's a feature. The Organisation Graph is a capability. Build the graph; search is one query against it.

**Engineering Intelligence** — don't build a dashboard that shows metrics. Engineering organisations already have metrics dashboards. Build insights from decisions, not measurements of process.

---

## Network effects

The roadmap doesn't get more complicated as it scales. It gets more connected. That's the difference between a platform and a feature list.

```
One developer
     ↓
One team
     ↓
One organisation
     ↓
One ecosystem
```

Each layer increases the value of the layers beneath it:

- **Runtime** creates context — one developer's AI starts understanding real code
- **Cloud** creates shared knowledge — a team's decisions compound instead of disappearing
- **Blueprint Hub** creates reusable expertise — what one team figured out becomes installable by every team
- **Organisation Graph** creates organisational intelligence — knowledge connects across boundaries that previously separated it
- **Engineering Intelligence** creates organisational judgement — the accumulated record of decisions becomes legible as insight

The flywheel in M1 is knowledge compounding for one developer. Engineering Intelligence is knowledge compounding for an entire industry.

Each approved review, each promoted ADR, each Blueprint installed, each organisation-level query answered — all of it makes the next one more valuable. Not just for the team that created it, but increasingly for every team that shares the same ecosystem.
