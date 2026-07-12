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

### Mission Builder / Engineering Workflows

A drag-and-drop, executable workflow builder — superficially like n8n, but for composing an engineering operating model rather than passing generic JSON between automation steps. Its native nodes would be ctxhub concepts: repositories, Captains, Workers, Missions, Knowledge Search, Promotion, Blueprints, Organisation Graph queries, dependency/impact analysis, trust and policy checks, human review, approvals, and external systems such as GitHub, Datadog, Jira, and Slack. A PR workflow might run dependency impact analysis, invoke the Architecture Captain, route low-trust findings to the owning team's principal engineer, promote accepted findings, and create an ADR.

The defensible difference is that every node can reason over shared platform context — Knowledge Objects, the Organisation Graph, identity and ownership, trust, corporate groups, policies, Workers, and Mission state — rather than treating the world as untyped payloads. This could make the Organisation Graph executable: find affected services, run the appropriate Captain, generate recommendations, notify their owners, request evidence or approval, and remember the outcome. Human gates should be first-class workflow semantics (approve, reject, request evidence, escalate), consistent with M10's non-autonomous recommendation principle, rather than merely another integration node.

Workflows should be Git-backed, versioned, reviewable, and deployable through the same PR process engineering teams already use. Mission Control would expose live run states (running, waiting for approval, blocked, retrying, failed, completed), while the event history would support replay of every node, model interaction, approval, timing, and resulting Knowledge Object. Complete flows could become installable Blueprints — for example, a reusable incident-response playbook — connecting this idea naturally to M11's Marketplace.

The builder should be bidirectional rather than canvas-only: users can describe a workflow in natural language and receive an editable graph, then drag nodes or ask the system to explain, validate, or refactor the result. “Mission Builder” is the strongest working name because it extends Mission Control's existing language and frames the canvas as another interface to the same engine alongside the CLI, REST API, MCP, Captains, and Workers.

This depends on several roadmap pieces becoming real enough to compose — especially M7's Org Graph, M10's Engineering Intelligence and approval boundary, M11's Marketplace, M17's impact analysis, M18's Workers, and M19's event history. Before promotion to a numbered milestone it needs a deliberately narrow first vertical slice and answers to execution semantics: durable state, retries and idempotency, secrets, permissions, version migration, failure recovery, and whether flows orchestrate existing Missions or replace their current execution model.

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

Mission Control not caring which model a Captain uses (Claude, GPT, Gemini, Llama, Bedrock, OpenRouter, Azure OpenAI, local Ollama) — "Personas decide" — is already the actual design: personas configure which agent/model runs a given task, not a hardcoded model choice threaded through the platform. Confirmed already-true rather than a gap; no roadmap entry needed unless a specific provider integration is missing (that would be a normal feature request, not a new primitive). Now further along than "already true": `config.llm.fallbackProfiles` (added alongside the demo-recording work) tries an ordered list of Execution Profiles and records every attempt — real infrastructure for "try another model when the first one fails," one step short of the AI Second Opinion idea below (running several models *concurrently* for consensus rather than *sequentially* for fallback).

## From a second brainstorming pass (ChatGPT, `ChatGPT-Brainstorming-Convo.txt`, 2026-07-12)

34 more ideas, organised by the five recurring primitives that pass's own analysis converged on — a genuinely useful compression, reused here rather than re-derived. Several duplicate what's already above under different names (noted inline, not re-explained); only the material that's actually new to this document gets real treatment.

**Already covered elsewhere — not re-litigated here:** BYOR (→ M18), Time Machine / "Flight Recorder" replay (→ M19), Engineering Digital Twin / Organisation Simulation (→ above), Engineering Workflow Builder / "Mission Builder" (→ above), Capability/Engineering/Captain Marketplace (→ above, extends M11), Trust Scores (→ above, extends the Trust Model), Learning Loops (→ this is just Observe → Understand → Recommend → Approve → Remember, M10's own already-stated loop, restated).

### Identity: Capability Graph

Beyond org/team ownership (already tracked via topology `owned_by` edges, M7): who has expertise in what, who mentors whom, where succession risk sits. A genuinely different graph from "who owns this service" — it's "who *understands* this service, and is that knowledge concentrated in one person." No existing hook; would need a new node/edge type on top of the Identity model, and a real question about where this data comes from (self-reported? inferred from promoted-finding authorship? both are weak signals on their own).

### Knowledge: Engineering Memory (episodic) and Knowledge Debt

Two distinct ideas worth keeping separate:
- **Episodic memory** — treating whole *events* (an incident, a migration, a security audit) as first-class objects with their own lifecycle, richer than a single promoted Knowledge Object, so "have we done something like this before?" is answerable. Meaningfully different from M7's Knowledge Graph, which models individual findings, not bounded episodes composed of many findings plus a timeline. Worth a proper design pass, not a bolt-on — probably wants its own schema (`episodes` linking to a set of `knowledge_objects` and a time range) rather than overloading the existing KO model.
- **Knowledge Debt** — the technical-debt framing applied to documentation gaps (undocumented services, stale ADRs, missing runbooks). This is almost entirely a *query* over data M7 already has (KO staleness, `review_flag`, topology nodes with zero associated KOs) — closer to a report than a new primitive. Cheapest of this whole batch to eventually build, if a real trigger shows up.

### Trust: Trust Decay and Engineering DNA

- **Trust Decay** — an explicit, time-based extension of the existing confidence model (ADR-008 already has confidence *decreasing* on file changes or contradiction; this adds *pure elapsed time since last review* as a third decay input). Small, concrete, and worth folding directly into ADR-008's model whenever M7's confidence logic gets its next real revision — doesn't need a separate milestone.
- **Engineering DNA** — Captain recommendations calibrated to an org's own historical patterns ("this doesn't match how you've built things before") rather than generic best practice. This is a real capability gap, not just a UI idea — it implies mining the Knowledge Graph for *style*, not just facts, which is a materially different (and harder) inference problem than anything M7–M10 currently do. Flag as genuinely hard, not just unbuilt.

### Execution: none new

Everything under "Execution" in the source (BYOR, Workflow Builder, Missions) already has a home above.

### Learning: Engineering Journal, Recommendation Inbox, AI Second Opinion, Explain Why, Cognitive Load Map

- **Engineering Journal** — an auto-generated daily/weekly digest ("3 new Knowledge Objects, 2 architecture decisions, 5 recommendations accepted"). Almost entirely a query + formatting layer over data M7/M10 already produce; the honest scope is "a scheduled report," not new infrastructure.
- **Recommendation Inbox** — recommendations accumulate for review rather than interrupting (GitHub-notifications style). Directly depends on M10's "recommendations, always human-gated" surface existing first — an inbox needs something to put in it.
- **AI Second Opinion** — run a recommendation past a second model concurrently and show consensus vs. single-model confidence as two distinct numbers. Meaningfully different from the fallback routing that now exists (sequential, for *reliability*) — this is parallel, for *calibration*. Real infra question: doubles LLM cost per recommendation, so this wants to be opt-in per recommendation type, not a blanket default.
- **Explain Why** — a one-click breakdown of a recommendation's evidence/trust/policy/dependency chain. This is arguably not a new feature so much as a UI investment in surfacing data ctxhub already computes (citations, confidence, provenance) but doesn't currently present as a single coherent "why" view. Cheapest genuinely-useful item in this whole document.
- **Cognitive Load Map** — visualising overloaded teams/services/knowledge bottlenecks (Team Topologies-flavoured). Depends on the Capability Graph (above) existing first to have anything real to visualise beyond topology node degree.

### The moonshot: Meeting Companion ("Engineering Copilot Mode")

Captain joins a call (with consent), and afterwards proposes: a meeting summary, ADRs worth drafting, Knowledge Objects worth promoting, ownership changes detected, follow-up Missions. Explicitly called out by the source material as the one idea with "I don't know how we lived without this" potential, and it's worth taking that seriously — every other idea in this document extends something ctxhub already does; this one captures knowledge from a source (live conversation) the platform currently has zero visibility into at all. That also makes it the least-grounded idea here: no existing ctxhub subsystem touches audio/transcription, meeting-platform integration, or real-time consent/privacy handling, so unlike everything else above, this genuinely starts from zero rather than extending existing infrastructure. Worth keeping on the list specifically *because* it's ambitious, not despite it — but it's a multi-quarter bet, not a natural next milestone.
