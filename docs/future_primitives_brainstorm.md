# Future primitives — brainstorm capture
*Status: Raw brainstorm, not yet promoted to numbered milestones · July 2026*

This document exists to not lose ideas, not to commit to them. Unlike ROADMAP.md's numbered milestones — each written with a specific promise, trigger, hypothesis, and exit condition — the entries below haven't had that rigour applied yet. Some will graduate into real milestones once they're worth that level of commitment; several already turn out, on inspection, to be extensions of things ctxhub has already built rather than new primitives. That's noted per entry, because it's the most useful output of doing this pass now rather than later.

The organising theme across nearly all of them, in the words that prompted this document: **ctxhub doesn't replace existing systems — it registers them, understands them, and orchestrates them.** BYOR (ROADMAP M18) does this for compute. Monorepo Support (M17) does it for build-tool topology. Time Machine (M19) does it for organisational history. The entries below extend that same pattern into knowledge sources, policy, models, memory, and governance.

## Genuinely new primitives (candidates for a future numbered milestone)

### Bring Your Own Knowledge (BYOK)

Let orgs register existing knowledge sources — Confluence, Notion, SharePoint, GitHub Wikis, ADR repositories, runbooks, RFCs — rather than forcing everything through `ctxhub knowledge create`/promote. ctxhub indexes them into the Org Graph instead of replacing them.

This is the same "register, don't replace" pattern as Monorepo Support (M17), applied to documentation instead of build topology. It would plausibly follow the same `Adapter` shape: a `KnowledgeSourceAdapter` per system, one canonical `KnowledgeObject` output regardless of source, validated against a real Confluence/Notion export rather than a hand-written fixture (per M17 §7's validation standard — the same discipline should apply here). Not yet promise/trigger/hypothesis-complete enough for a numbered milestone; worth returning to once M7's Knowledge Graph has enough real usage to know what "register an external source" would actually need to satisfy.

### Bring Your Own Policies

Policy-as-code (`no_direct_prod_access`, `security_review_required`, `pii_detection`) that Captains enforce and Mission Control reports on. Distinct from RBAC (who can do what in ctxhub itself, [ADR-012](adr/ADR-012-rbac-minimalism.md)) — this is about encoding an org's *engineering* policy so it becomes something a Captain can check for, not just something written in a wiki page nobody reads before an incident.

Real open question before this is milestone-ready: what's the enforcement boundary? A Captain that *flags* a policy violation is a small, credible feature. A Captain that *blocks* something is a much bigger claim about ctxhub's role in a workflow, and collides with the "recommendations are never autonomous, always human-gated" principle already stated in M10's design. Needs that tension resolved before it's a real milestone, not just a compelling diagram.

### Bring Your Own Memory

Let orgs register their own memory backend — Mem0, Graphiti, Neo4j, a plain Postgres instance — instead of ctxhub owning memory storage outright.

Worth noting this is partially already true: MemPalace is already ctxhub's own pluggable memory provider (`memory.provider: local-json` vs. a real MemPalace install, see `examples/reference-workspace/README.md`), and the config already treats "where memory lives" as a provider choice, not a hardcoded storage layer. The idea here is broadening that existing provider abstraction to more backends, not introducing a new concept from zero. Closer to "add more providers to something that already exists" than a new primitive.

### Bring Your Own Governance

Configurable approval chains (principal engineer sign-off, security review, architecture board, change advisory board) that plug into however a specific enterprise already runs governance, rather than ctxhub imposing its own approval model.

Overlaps significantly with **Bring Your Own Policies** above — both are "let the org encode their own process rather than assuming ctxhub's." Worth merging into a single governance/policy milestone once either is closer to real, rather than building two overlapping systems.

## Extensions of milestones that already exist

### Bring Your Own Topology (extends M17 Monorepo Support)

The user's framing: "don't rediscover structure, import it" — Terraform graphs, Kubernetes graphs, Backstage catalogs, AWS resource graphs, GitHub's own dependency graph, in addition to the monorepo build-tool graphs M17 already covers. This is the same `WorkspaceAdapter`-shaped idea in `docs/monorepo_architecture.md`, just with a wider set of source systems than "monorepo build tool." When M17's Phase 1 adapter gets built, this is the natural direction to broaden `WorkspaceGraph`'s sources in — not a separate milestone.

### Bring Your Own Fleet (extends M18 Distributed Workers)

Registering many workers across regions/teams (`Team A: 15 workers on AWS`, `Team B: 20 on Kubernetes`, `Team C: laptops`) with Mission Control scheduling globally. This is M18's own Phase 4 ("Fleet-scale dispatch") — not a distinct primitive, just what BYOR looks like at scale. Already captured there.

### Capability Marketplace / Engineering Marketplace

Installable Workers-as-plugins (Datadog Worker, Terraform Worker, Snowflake Worker) and, in the broader "Engineering Marketplace" framing, installable Captains/Policies/Blueprints/Personas/org templates as well. This is M11 (Marketplace) broadened to cover more asset types than blueprints, plus M18's "workers become plugins" framing applied to the same distribution mechanism. Rather than a new milestone, this is most honestly described as: M11's scope question, revisited once M18 exists, of whether the same marketplace should distribute workers too.

### Trust Scores

Extending confidence/trust beyond Knowledge Objects (already scored per [ADR-008](adr/ADR-008-confidence-is-organisational.md)) to Workers, Captains, Blueprints, Policies, and Recommendations — so a recommendation can be "high confidence AND high trust" as two distinct axes.

This is not a new system — it's the existing [Trust Model](trust_model.md)'s hierarchy (Unverified → Reviewed → Promoted → Institutional → Canonical) and ADR-008's "organisational signal, not model-generated" principle, applied to more entity types than it currently covers. The real work here is deciding whether one trust model genuinely generalises across such different entities (a Worker's trust and a Knowledge Object's confidence are earned very differently), not designing a new scoring mechanism from scratch.

### Organisation Learning

"This incident happened six months ago, here's how you solved it" / "Team B already solved this migration." This is restating the Org Graph's own founding promise from `docs/org_graph_architecture.md` §1 ("institutional memory that survives team turnover") and M10 Engineering Intelligence's "recommendations become evidence-backed... through Observe → Understand → Recommend → Approve → Remember." Not a new milestone — a good one-line pitch for M7/M10 that's worth stealing for external-facing copy, not a gap in the roadmap.

### Engineering Replay

"Incident → replay everything → timeline → agent reasoning → human approvals → knowledge created," positioned for audits. This is Time Machine (M19) applied specifically to incident review, plus M2's already-built "Mission replay (basic)" (click any Captain run to see full detail — answer, citations, promote actions) extended to chain multiple runs into one incident timeline. Once M19 exists, this is a specific UI view over it (an "incident lens" on the same replay data), not a separate system.

### Live Engineering Map

A live, FlightRadar-style view of repositories → packages → teams → workers → incidents → Captains → knowledge → recommendations. This is `docs/org_graph_architecture.md` §8 (Mission Control Graph View — force-directed, topology + knowledge layers, already fully specced) plus M18's worker registry and M10's intelligence layer, rendered as one live dashboard once all three exist. Not a new design — a compelling "north star" UI that becomes buildable once its dependencies (M7's graph view, M18, M10) are further along than they are today.

### Engineering Digital Twin

"What happens if we archive Service X?" / "If this library changes, what breaks?" / "Who owns the blast radius?" — simulation rather than documentation, over the Org Graph.

This is the most genuinely novel idea in this list that *doesn't* cleanly map onto something already built — it's a step beyond M10's Engineering Intelligence (which observes and recommends) into actually simulating a hypothetical change before it happens. Closest existing hook: M17's `affectedProjects()`/impact-query phase (§5 of `docs/monorepo_architecture.md`) answers "what's affected by a real change," which is adjacent to but short of "what would be affected by a hypothetical one." Worth watching as M17 and M10 mature — likely becomes real only once both have enough real usage to know what a simulation actually needs to be trustworthy, rather than a plausible-looking guess.

## Already true today (no new work implied)

### Bring Your Own Models

Mission Control not caring which model a Captain uses (Claude, GPT, Gemini, Llama, Bedrock, OpenRouter, Azure OpenAI, local Ollama) — "Personas decide" — is already the actual design: personas configure which agent/model runs a given task, not a hardcoded model choice threaded through the platform. Confirmed already-true rather than a gap; no roadmap entry needed unless a specific provider integration is missing (that would be a normal feature request, not a new primitive).
