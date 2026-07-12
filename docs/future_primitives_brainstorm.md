# Future primitives — brainstorm capture
*Status: Raw brainstorm, not yet promoted to numbered milestones · July 2026*

A shopping list, not a priority order. Every idea below came out of the same brainstorming conversations (`ChatGPT-Brainstorming-Convo.txt` plus earlier chat discussion) and is captured here so nothing gets lost before it's decided whether to build it. None of these are roadmap commitments — unlike ROADMAP.md's numbered milestones (each with a specific promise, trigger, hypothesis, and exit condition), nothing here has had that rigour applied yet. Two ideas from this same brainstorming — **Bring Your Own Runtime** and **Engineering Time Machine** — already graduated into ROADMAP.md as Milestones 18 and 19; they're not re-listed here.

The recurring theme, in the words that prompted this document: **ctxhub doesn't replace existing systems — it registers them, understands them, and orchestrates them.** Most entries below are a variation on that pattern applied to a new surface (knowledge sources, policy, models, memory, governance, meetings). Each entry notes what it would connect to in the current codebase, where that's known — not as a ranking, just as a pointer for whoever picks it up next.

---

## AI Second Opinion

Run a recommendation past a second model concurrently and show consensus confidence alongside single-model confidence, as two distinct numbers. Different from the sequential LLM fallback routing that already exists (`config.llm.fallbackProfiles`, added for reliability — try another route if the first fails) — this is parallel, for calibration, and roughly doubles LLM cost per recommendation. Would want to be opt-in per recommendation type, not a blanket default.

## Bring Your Own Fleet

Registering many Workers across regions and teams (`Team A: 15 workers on AWS`, `Team B: 20 on Kubernetes`, `Team C: laptops`) with Mission Control scheduling globally. A scaling question for M18 (Distributed Workers) rather than a separate system — see `docs/distributed_workers_architecture.md` §6 Phase 4.

## Bring Your Own Governance

Configurable approval chains (principal engineer sign-off, security review, architecture board, change advisory board) that plug into however a specific enterprise already runs governance, rather than ctxhub imposing its own approval model. Overlaps with Bring Your Own Policies below — both are "let the org encode their own process."

## Bring Your Own Knowledge (BYOK)

Let orgs register existing knowledge sources — Confluence, Notion, SharePoint, GitHub Wikis, ADR repositories, runbooks, RFCs — rather than forcing everything through `ctxhub knowledge create`/promote, and have ctxhub index them into the Org Graph. Would plausibly follow the same adapter shape as Monorepo Support (M17): a `KnowledgeSourceAdapter` per system, one canonical `KnowledgeObject` output regardless of source, validated against a real Confluence/Notion export rather than a hand-written fixture (the same standard M17 §7 sets for its adapters).

## Bring Your Own Memory

Let orgs register their own memory backend — Mem0, Graphiti, Neo4j, a plain Postgres instance — rather than ctxhub owning memory storage outright. Partially already true: MemPalace is already a pluggable memory provider (`memory.provider: local-json` vs. a real MemPalace install), so this is really "add more providers to an abstraction that already exists," not a new concept.

## Bring Your Own Models

Mission Control not caring which model a Captain uses (Claude, GPT, Gemini, Llama, Bedrock, OpenRouter, Azure OpenAI, local Ollama) — personas already configure which agent/model runs a given task, not a hardcoded choice threaded through the platform. Already true today. `config.llm.fallbackProfiles` takes it a step further — an ordered list of Execution Profiles tried in sequence, with every attempt recorded — which is adjacent to, but not the same as, AI Second Opinion above (sequential fallback vs. concurrent consensus).

## Bring Your Own Policies

Policy-as-code (`no_direct_prod_access`, `security_review_required`, `pii_detection`) that Captains check for and Mission Control reports on. Distinct from RBAC — who can do what in ctxhub itself ([ADR-012](adr/ADR-012-rbac-minimalism.md)) — this is encoding an org's *engineering* policy. Open question: a Captain that *flags* a violation is a small feature; a Captain that *blocks* something is a bigger claim, and would need to be reconciled with the "recommendations are never autonomous, always human-gated" principle M10 already states.

## Bring Your Own Topology

Importing structure instead of rediscovering it — Terraform graphs, Kubernetes graphs, Backstage catalogs, AWS resource graphs, GitHub's own dependency graph — extending the same `WorkspaceAdapter` idea Monorepo Support (M17) already defines for build-tool graphs, just with a wider set of source systems. The natural direction to broaden `WorkspaceGraph`'s sources once M17's first adapter exists.

## Capability Graph

Not org/team ownership (already tracked via topology `owned_by` edges, M7) but who has expertise in what, who mentors whom, where succession risk sits — a graph of "who understands this," not "who owns this." No existing hook; would need a new node/edge type, and a real answer for where the data comes from (self-reported and inferred-from-authorship are both weak signals on their own).

## Cognitive Load Map

Visualising overloaded teams, overloaded services, and knowledge bottlenecks (Team Topologies-flavoured). Wants Capability Graph above to exist first — otherwise there's nothing to visualise beyond raw topology node degree.

## Engineering Digital Twin

"What happens if we archive Service X?" / "If this library changes, what breaks?" / "Who owns the blast radius?" — simulation over the Org Graph rather than just observation. A step beyond M10's Engineering Intelligence (which observes and recommends) into modelling a hypothetical change before it happens. Closest existing hook: M17's `affectedProjects()`/impact-query phase answers "what's affected by a real change," which is adjacent to but short of "what would be affected by a hypothetical one."

## Engineering DNA

Captain recommendations calibrated to an org's own historical patterns ("this doesn't match how you've built things before") rather than generic best practice. Implies mining the Knowledge Graph for *style*, not just facts — a materially different and harder inference problem than anything M7–M10 currently do.

## Engineering Journal

An auto-generated daily or weekly digest ("3 new Knowledge Objects, 2 architecture decisions, 5 recommendations accepted"). Mostly a query-and-formatting layer over data M7/M10 already produce, rather than new infrastructure.

## Engineering Memory (episodic)

Treating whole *events* — an incident, a migration, a security audit — as first-class objects with their own lifecycle, richer than a single promoted Knowledge Object, so "have we done something like this before?" is answerable. Meaningfully different from M7's Knowledge Graph, which models individual findings, not bounded episodes composed of many findings plus a timeline; would likely want its own schema (`episodes` linking a set of `knowledge_objects` to a time range) rather than overloading the existing KO model.

## Engineering Replay

"Incident → replay everything → timeline → agent reasoning → human approvals → knowledge created," aimed at audits. Time Machine (M19) applied specifically to incident review, chaining multiple runs into one timeline — once M19 exists, this reads as a specific view over it (an "incident lens") rather than a separate system. Overlaps with M2's already-built "Mission replay" (click any Captain run for full detail).

## Explain Why

A one-click breakdown of a recommendation's evidence, trust, policy, and dependency chain. Less a new feature than a UI investment in surfacing data ctxhub already computes (citations, confidence, provenance) as a single coherent view rather than scattered across the UI.

## Knowledge Debt

The technical-debt framing applied to documentation gaps — undocumented services, stale ADRs, missing runbooks. Almost entirely a query over data M7 already has (KO staleness, `review_flag`, topology nodes with zero associated KOs) rather than new infrastructure.

## Live Engineering Map

A live, FlightRadar-style view of repositories → packages → teams → workers → incidents → Captains → knowledge → recommendations. `docs/org_graph_architecture.md` §8 (Mission Control Graph View — force-directed, topology + knowledge layers) already specs the visual design; this is that view plus M18's worker registry and M10's intelligence layer, rendered as one live dashboard once all three exist.

## Marketplace (Captains, Workers, Policies, Workflows)

Installable Workers-as-plugins (Datadog Worker, Terraform Worker, Snowflake Worker) and, more broadly, installable Captains/Policies/Blueprints/Personas/org templates. M11's existing Marketplace milestone, revisited for a wider set of asset types than blueprints alone, informed by M18's "workers become plugins" framing.

## Meeting Companion ("Engineering Copilot Mode")

Captain joins a call (with consent), and afterwards proposes a meeting summary, ADRs worth drafting, Knowledge Objects worth promoting, ownership changes detected, and follow-up Missions. The one idea here that starts from zero rather than extending something that exists — no current ctxhub subsystem touches audio/transcription, meeting-platform integration, or real-time consent/privacy handling. A multi-quarter bet if picked up, not an incremental feature.

## Mission Builder / Engineering Workflows

A drag-and-drop, executable workflow builder — superficially like n8n, but composing ctxhub's own concepts (Captains, Workers, Missions, Knowledge Search, Promotion, Blueprints, Org Graph queries, dependency/impact analysis, trust and policy checks, human review, approvals, and external systems like GitHub, Datadog, Jira, Slack) rather than generic JSON payloads. A PR workflow might run dependency impact analysis, invoke the Architecture Captain, route low-trust findings to the owning team's principal engineer, promote accepted findings, and create an ADR.

The defensible difference from a generic workflow tool is that every node reasons over shared platform context (Knowledge Objects, the Org Graph, identity/ownership, trust, corporate groups, policies, Worker and Mission state) instead of treating the world as untyped payloads. Human gates (approve, reject, request evidence, escalate) would need to be first-class workflow semantics, consistent with M10's non-autonomous-recommendation principle, not just another integration node. Workflows would want to be Git-backed and versioned, with complete flows installable as Blueprints (connecting to Marketplace above — a reusable incident-response playbook, for instance). Bidirectional authoring (describe in natural language, get an editable graph, or vice versa) rather than canvas-only.

Depends on several other pieces existing first to have anything to compose: M7's Org Graph, M10's approval boundary, Marketplace, M17's impact analysis, M18's Workers, M19's event history. Open questions before this is buildable at all: durable state, retries and idempotency, secrets handling, permissions, version migration, failure recovery, and whether flows orchestrate existing Missions or replace their execution model.

## Organisation Learning

"This incident happened six months ago, here's how you solved it" / "Team B already solved this migration." Restates the Org Graph's own founding promise (`docs/org_graph_architecture.md` §1, "institutional memory that survives team turnover") and M10's Observe → Understand → Recommend → Approve → Remember loop — a pitch for M7/M10, not a separate idea, but worth keeping as a reminder of how to talk about what's already there.

## Recommendation Inbox

Recommendations accumulate for review rather than interrupting — GitHub-notifications style. Needs M10's "recommendations, always human-gated" surface to exist first; an inbox needs something to put in it.

## Trust Decay

An explicit, time-based extension of the existing confidence model — [ADR-008](adr/ADR-008-confidence-is-organisational.md) already decreases confidence on file changes or contradiction; this adds pure elapsed time since last review as a third decay input. Small and concrete enough to fold directly into ADR-008's model whenever M7's confidence logic next gets revised, rather than needing its own milestone.

## Trust Scores

Extending confidence/trust beyond Knowledge Objects (already scored per ADR-008) to Workers, Captains, Blueprints, Policies, and Recommendations, so a recommendation can be "high confidence AND high trust" as two distinct axes. Not a new system — the existing [Trust Model](trust_model.md) hierarchy and ADR-008's "organisational signal, not model-generated" principle, applied to more entity types. Open question: whether one trust model genuinely generalises across such different entities, since a Worker's trust and a Knowledge Object's confidence are earned very differently.
