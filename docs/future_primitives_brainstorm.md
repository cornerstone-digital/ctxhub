# Future primitives — brainstorm capture
*Status: Raw brainstorm, not yet promoted to numbered milestones · July 2026*

A shopping list, not a priority order. Every idea below came out of the same brainstorming conversations (`ChatGPT-Brainstorming-Convo.txt` plus earlier chat discussion) and is captured here so nothing gets lost before it's decided whether to build it. None of these are roadmap commitments — unlike ROADMAP.md's numbered milestones (each with a specific promise, trigger, hypothesis, and exit condition), nothing here has had that rigour applied yet. Two ideas from this same brainstorming — **Bring Your Own Runtime** and **Engineering Time Machine** — already graduated into ROADMAP.md as Milestones 18 and 19; they're not re-listed here.

The recurring theme, in the words that prompted this document: **ctxhub doesn't replace existing systems — it registers them, understands them, and orchestrates them.** Most entries below are a variation on that pattern applied to a new surface (knowledge sources, policy, models, memory, governance, meetings). Each entry notes what it would connect to in the current codebase, where that's known — not as a ranking, just as a pointer for whoever picks it up next.

**A principle worth stating separately, because it's architectural rather than a feature in its own right:** ctxhub should not have a single primary interface. CLI, Mission Control, Chat, Voice, a Workflow Builder, MCP, the REST API, IDE extensions, mobile, Alexa — each is a different way of interacting with the same underlying engineering operating model, and the platform should be able to evolve independently of any one of them. Several entries below (Voice-Native Mission Control, Mission Builder, Meeting Intelligence) are really instances of this same principle applied to a specific surface, not unrelated ideas.

**Index, grouped for scanning only — not a priority order; the entries themselves stay alphabetical below.**

- **Interaction:** [Meeting Intelligence](#meeting-intelligence) · [Mission Builder / Engineering Workflows](#mission-builder--engineering-workflows) · [Voice-Native Mission Control](#voice-native-mission-control)
- **Execution & distribution:** [Bring Your Own Fleet](#bring-your-own-fleet) · [Marketplace](#marketplace-captains-workers-policies-workflows)
- **Knowledge:** [Bring Your Own Knowledge (BYOK)](#bring-your-own-knowledge-byok) · [Bring Your Own Memory](#bring-your-own-memory) · [Bring Your Own Topology](#bring-your-own-topology) · [Engineering Memory (episodic)](#engineering-memory-episodic) · [Knowledge Debt](#knowledge-debt) · [Organisation Learning](#organisation-learning)
- **Trust & governance:** [Bring Your Own Governance](#bring-your-own-governance) · [Bring Your Own Policies](#bring-your-own-policies) · [Explain Why](#explain-why) · [Recommendation Inbox](#recommendation-inbox) · [Trust Decay](#trust-decay) · [Trust Scores](#trust-scores)
- **Visualisation & awareness:** [AI Budget Manager](#ai-budget-manager) · [Cognitive Load Map](#cognitive-load-map) · [Context Lens](#context-lens) · [Engineering Health](#engineering-health) · [Engineering Presence (Ambient Intelligence)](#engineering-presence-ambient-intelligence) · [Engineering Replay](#engineering-replay) · [Live Engineering Map](#live-engineering-map) · [Living Organisation](#living-organisation)
- **Intelligence & reasoning:** [AI Second Opinion](#ai-second-opinion) · [Bring Your Own Models](#bring-your-own-models) · [Capability Graph](#capability-graph) · [Engineering Digital Twin](#engineering-digital-twin) · [Engineering DNA](#engineering-dna) · [Engineering Sandbox](#engineering-sandbox)

---

## AI Budget Manager

Reframes AI spend as engineering ROI instead of a token count: not "we spent 50 million tokens" but "we spent £200 and saved £6,000." The Usage view already tracks tokens returned/saved per tool — this is the same underlying data, presented as a cost/value statement instead of a token count. Needs a real cost-per-token figure per model/provider to be honest, which the current usage-stats model doesn't track (see `src/utils/usageStats.ts` — no cost field yet, only token counts).

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

## Context Lens

Every screen in Mission Control viewed through a chosen perspective — repository, team, organisation, corporate group, incident, sprint, capability — with the same underlying data reshaped around whichever lens is active, rather than separate screens per perspective. A UI/query-layer idea more than a new data model: the Org Graph (M7) already has most of these as real dimensions (workspace, org, group), so this is largely about building one filtering mechanism that every view respects, instead of each view inventing its own ad hoc filters.

## Engineering Digital Twin

"What happens if we archive Service X?" / "If this library changes, what breaks?" / "Who owns the blast radius?" — simulation over the Org Graph rather than just observation. A step beyond M10's Engineering Intelligence (which observes and recommends) into modelling a hypothetical change before it happens. Closest existing hook: M17's `affectedProjects()`/impact-query phase answers "what's affected by a real change," which is adjacent to but short of "what would be affected by a hypothetical one."

## Engineering DNA

Captain recommendations calibrated to an org's own historical patterns ("this doesn't match how you've built things before") rather than generic best practice. Implies mining the Knowledge Graph for *style*, not just facts — a materially different and harder inference problem than anything M7–M10 currently do.

## Engineering Health

A GitHub-contribution-graph-style dashboard for organisational learning instead of commits: Knowledge Capture Rate, Recommendations Accepted, Trust growth, Knowledge reuse, AI spend saved, engineering hours saved — squares on a calendar, coloured by activity, but the activity is learning rather than code. Distinct from the Usage view (which tracks token/cost mechanics) — this is the outcome layer on top: what the organisation *got* from that activity, not what it cost.

Naturally includes an auto-generated daily or weekly digest as its "today" view — "+4 Knowledge Objects, +2 architecture decisions, +17 recommendations accepted, engineering health +3%." Mostly a query-and-formatting layer over data M7/M10 already produce, rather than new infrastructure; the real design work is picking metrics that are genuinely load-bearing signals rather than vanity counters.

## Engineering Memory (episodic)

Treating whole *events* — an incident, a migration, a security audit — as first-class objects with their own lifecycle, richer than a single promoted Knowledge Object, so "have we done something like this before?" is answerable. Meaningfully different from M7's Knowledge Graph, which models individual findings, not bounded episodes composed of many findings plus a timeline; would likely want its own schema (`episodes` linking a set of `knowledge_objects` to a time range) rather than overloading the existing KO model.

## Engineering Presence (Ambient Intelligence)

Broader than "Mission Control changes mode": Captain senses what an engineer is currently doing — coding, reviewing, deploying, in an incident, in a meeting — without being explicitly told, from signals already available in tools ctxhub integrates with (a PR open, an incident Captain running, a release Job in flight). Contextual rather than surveillance. The mode-switching framing (Incident Mode, Release Mode, the Architecture lens appearing during a review) is one consumer of this signal; others could include which Context Lens is suggested, which recommendations surface first, what Voice-Native Mission Control assumes about intent, and which notifications are worth interrupting for. Treat it as an ambient-awareness primitive several other entries could plug into, not a single feature — which also means it's realistically one of the last things here to build, since it needs several of the others to have something to feed.

## Engineering Replay

"Incident → replay everything → timeline → agent reasoning → human approvals → knowledge created," aimed at audits. Time Machine (M19) applied specifically to incident review, chaining multiple runs into one timeline — once M19 exists, this reads as a specific view over it (an "incident lens") rather than a separate system. Overlaps with M2's already-built "Mission replay" (click any Captain run for full detail).

## Engineering Sandbox

"Captain, show me what would happen if we upgraded React" — a temporary, simulated workspace where Captain runs dependency analysis, build, tests, architecture checks, security checks, and impact analysis against a hypothetical change, with nothing touching the real workspace, and reports back "safe" or "17 packages would break." A natural combination of Engineering Digital Twin (the simulation idea) and BYOR (a disposable Worker to actually run the checks in) rather than a standalone system — the interesting new part is the "temporary, throwaway, side-effect-free" workspace semantics, which neither of those two ideas currently specifies.

## Explain Why

A one-click breakdown of a recommendation's evidence, trust, policy, and dependency chain. Less a new feature than a UI investment in surfacing data ctxhub already computes (citations, confidence, provenance) as a single coherent view rather than scattered across the UI.

## Knowledge Debt

The technical-debt framing applied to documentation gaps — undocumented services, stale ADRs, missing runbooks. Almost entirely a query over data M7 already has (KO staleness, `review_flag`, topology nodes with zero associated KOs) rather than new infrastructure.

## Live Engineering Map

A live, FlightRadar-style view of repositories → packages → teams → workers → incidents → Captains → knowledge → recommendations. `docs/org_graph_architecture.md` §8 (Mission Control Graph View — force-directed, topology + knowledge layers) already specs the visual design; this is that view plus M18's worker registry and M10's intelligence layer, rendered as one live dashboard once all three exist.

## Living Organisation

Broader than Live Engineering Map above: not one graph view, but Mission Control feeling alive everywhere — Workers joining, Captains running, knowledge getting promoted, trust changing, approvals waiting, all surfacing as a live activity feed (closer to GitHub Actions meets a Slack activity stream than a static dashboard). Live Engineering Map is the spatial/topology version of this; Living Organisation is the temporal/activity version — the event bus (`src/events/eventBus.ts`) already carries every one of these events in real time, so the gap is presentation, not data.

## Marketplace (Captains, Workers, Policies, Workflows)

Installable Workers-as-plugins (Datadog Worker, Terraform Worker, Snowflake Worker) and, more broadly, installable Captains/Policies/Blueprints/Personas/org templates. M11's existing Marketplace milestone, revisited for a wider set of asset types than blueprints alone, informed by M18's "workers become plugins" framing.

## Meeting Intelligence

Deliberately not called "Meeting Companion" — that undersells it as another note-taker. Captain joins a call (with consent), and afterwards proposes real organisational state changes: a meeting summary, ADRs worth drafting, Knowledge Objects worth promoting, ownership changes detected, and follow-up Missions. The output is updates to Knowledge, Ownership, Missions, and ADRs, not a transcript — the same "ephemeral conversation becomes durable organisational knowledge" idea the rest of this document keeps returning to, applied to the one source ctxhub currently has zero visibility into.

The one idea here that starts from zero rather than extending something that exists — no current ctxhub subsystem touches audio/transcription, meeting-platform integration, or real-time consent/privacy handling. A multi-quarter bet if picked up, not an incremental feature.

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

## Voice-Native Mission Control

Voice as a first-class interaction surface alongside CLI, Mission Control, Chat, and MCP — not dictation, but letting an engineer think out loud and have ctxhub convert that into structured engineering work. The worked example from the brainstorm: *"Hey Captain, I'm worried yesterday's auth refactor might affect mobile clients — check the dependency graph, look for previous incidents, run the Architecture Captain and tell me if I should be concerned."* Mission Control responds with interpreted intent, affected systems, existing knowledge, proposed actions, estimated cost, and required approvals — voice proposes, a human still approves, exactly like every other recommendation surface in this platform. Nothing here overrides M10's non-autonomous principle; it's a new way to *ask*, not a new way to *act*.

Staged rather than all-or-nothing: push-to-talk on web and mobile with off-the-shelf speech-to-text is the cheap, reliable starting point; a local wake phrase ("Hey Captain" — see below), a desktop companion, and an Alexa skill for ambient status checks ("any production incidents? has my mission completed?") are further out and each a real, separate integration surface, not a bigger version of the same feature.

**"Hey Captain" is branding, not just a wake word.** The platform's existing vocabulary — Mission Control, Captains, Workers, Missions — already gives it an identity distinct from "an AI assistant." A voice interface that says "Hey Captain" instead of "Hey AI" reinforces that the user is addressing the operating model, not a generic chatbot; worth keeping in mind for any voice work even before wake-word detection itself is real.

---

## Engineering Operating System

Looking across everything above, a consistent pattern emerges: none of these ideas are attempts to replace an existing engineering system. They're different ways of interacting with, extending, or reasoning over the same underlying operating model. Whether through voice, workflows, meetings, knowledge sources, workers, or marketplace integrations, the platform underneath stays the same. The interfaces evolve independently; the engineering operating model is the constant.

That's the thesis this whole document keeps arriving at from different directions, and it's worth stating once, plainly, rather than leaving it implicit in 31 separate entries: **import rather than recreate, orchestrate rather than replace, capture rather than lose, recommend rather than automate, learn rather than repeat.**
