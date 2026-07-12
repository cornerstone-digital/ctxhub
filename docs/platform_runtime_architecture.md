# ctxhub as a Platform Runtime
Architecture Design Document — v2
*Status: Draft, strategic option under consideration — not a roadmap commitment · July 2026*

## 1. The realization

Everything built so far has been framed as "ctxhub, a development team assistant." That framing turns out to be narrower than what's actually been built. A second, unrelated product idea — DealLedger, a property-investment platform — needs almost the same primitives: identity-scoped knowledge, trust-scored findings, AI workers that execute bounded tasks, a workflow engine, a marketplace for installable capabilities, voice as an interaction surface, and an event-driven Mission Control to see it all. Two independent products wanting the same underlying machinery is a real signal, not a hypothetical one — it's one of the few legitimate reasons to extract a platform *before* a single product has proven the whole thing out, rather than the more common (and usually wrong) instinct to generalize speculatively from one codebase.

This document isn't trying to justify building a platform. It's asking what evidence has already been gathered, by accident, that suggests one might already exist. **It captures the case for treating ctxhub as a platform runtime that applications are built on, not a single application.** It does not commit to building it. See §9 for what would actually need to be true before this becomes real, and §10 for how to know if it stops being true later.

## 2. Three architectures considered

**Option 1 — Separate SaaS.** DealLedger calls ctxhub Cloud over REST for knowledge/workers/Mission Control. The obvious shape, and the wrong one: DealLedger becomes tightly coupled to a network call for everything it does, with all the latency, availability, versioning, and auth overhead that implies. Every ctxhub outage becomes a DealLedger outage.

**Option 2 — Shared library.** DealLedger imports ctxhub as a package. Swings too far the other way — now every consuming application embeds Mission Control, Workers, Marketplace, Voice, and Identity wholesale, whether it needs all of them or not, and upgrading the shared library becomes a coordinated release across every application built on it.

**Option 3 — Platform runtime.** Applications don't call individual services — they call the runtime, and the runtime provides the platform services underneath. This is the shape that actually holds up:

```
                 Applications
   ctxhub (engineering)   DealLedger (property)   [future: healthcare, ...]
──────────────────────────────────────────────────────────────
                  ctxhub Platform Runtime
   Identity · Knowledge · Trust · Mission Engine · Worker Runtime
   Workflow Engine · Event Bus · Graph Engine · Voice · Marketplace
   Extension SDK
──────────────────────────────────────────────────────────────
                      Adapters
   GitHub · AWS · Datadog · Land Registry · Rightmove · Planning
   Portal · Confluence · etc.
```

The reference shape for this pattern: **VS Code is not Electron — it's an application running on Electron.** Electron provides windows, menus, the filesystem, IPC; VS Code provides the editor, the explorer, the git UI. Or: applications don't call `etcd` directly, they call Kubernetes, and Kubernetes decides. "Runtime" is the right word for this layer, not "kernel" — kernel implies something low-level (OS, drivers); what's actually being described is platform capabilities, an SDK, lifecycle management, extensions. In this architecture, "ctxhub" (the engineering product used throughout this repo so far) and DealLedger become two applications on the same runtime, not two products that happen to share a vendor.

## 3. The refinement that matters: an extension contract, with no application privileged

The naive version of Option 3 makes the runtime "own" property logic, which recreates Option 2's problem one layer down. The better shape keeps the runtime opinionated about *how organisations think, learn, trust, and execute* — and nothing else. Extensions sit beside each other, not underneath a privileged first application:

```
ctxhub Platform Runtime
├── Identity · Knowledge · Trust
├── Mission Engine · Worker Runtime · Workflow Engine
├── Event Bus · Graph Engine
├── Voice · Marketplace
└── Extension SDK

        │                    │                    │
        ▼                    ▼                    ▼
Engineering Extension   DealLedger Extension   [Healthcare, Legal, ...]
├── Repository types    ├── Property types      (same contract,
├── Architecture         ├── Investment           not yet built)
│   Captains             │   Captains
├── Git Workers          ├── Property Workers
├── CI workflows         ├── Deal workflows
└── Engineering UI       └── Property UI
```

This is a subtle but important distinction from how the diagram in §2 first draws it: engineering is not the platform with DealLedger bolted on, and DealLedger is not a plugin to an engineering tool. Both are peer extensions of the same runtime, including the engineering product this whole repository has been building. Put plainly: **ctxhub (as used throughout this codebase so far) is the reference implementation of the platform, not the platform itself.** Engineering is simply the first extension, because engineering happened to be the domain the platform was discovered inside of — not because it's structurally privileged. Nothing about the runtime should ever need to know it's "engineering-flavoured" for that first extension to work.

Extensions register with the runtime rather than the runtime hardcoding them:

```ts
ctxhub.registerKnowledgeType('ComparableSale' /* or */, 'PlanningPermission', 'MortgageProduct')
ctxhub.registerWorker('PlanningPortalWorker')
ctxhub.registerCaptain({ id: 'planning', domain: 'property', execute() { /* ... */ } })
ctxhub.registerMission('AnalyseProperty', 'ReviewPlanning', 'InvestmentPack')
```

Once registered, Mission Control, the Graph Engine, and the Marketplace understand the new types automatically — they render Missions, traverse graph nodes, and list installable Captains generically, the same code path regardless of whether the node is a `Repository` or a `Property`. An application built this way calls a typed SDK (`ctxhub.knowledge`, `ctxhub.workers`, `ctxhub.missions`, `ctxhub.voice`, `ctxhub.workflow`, `ctxhub.identity`, `ctxhub.graph`, `ctxhub.events`) and **composes platform primitives rather than bypassing them** — the discipline that matters here isn't the SDK's shape, it's that DealLedger is never tempted to decide "I'll just build my own worker system" or "I'll just build my own graph" because reaching for the platform primitive is always the easier path.

## 4. The Platform Contract

The dividing line from §3, stated as a contract rather than left implicit in a diagram:

**Every application built on the runtime may assume the existence of:** Identity, Knowledge, Trust, Events, Missions, Workers, Policies, Marketplace, Graph, Voice.

**Every application contributes, and is solely responsible for:** domain node types, domain Workers, domain Captains, domain workflows, domain UI, domain knowledge types.

**The runtime never learns domain concepts. Applications never reimplement platform primitives.** That second sentence is the one worth enforcing the hardest — the moment either side is violated (the runtime grows an `if domain === 'property'` branch, or an application quietly builds its own event bus because the platform one didn't fit), the boundary has failed and the "two independent domains, one platform" evidence from §1 stops being true.

One further evolution worth flagging without committing to it: the registration calls in §3 (`registerKnowledgeType`, `registerWorker`, `registerCaptain`, `registerMission`) could eventually collapse into one generic shape — `ctxhub.registerCapability({ type: 'knowledge' | 'worker' | 'voice' | 'model' | 'storage' | 'auth', provider })` — so knowledge, voice, models, workers, storage, and authentication are all just capabilities an application composes, rather than each having its own bespoke registration API. Likely overkill for a first extension; worth revisiting once there are enough registration call shapes to see whether they actually converge or genuinely differ.

## 5. What's already generic in this codebase, and what isn't

This isn't a purely hypothetical reshaping — worth being honest about how much of what's already built this session already fits this shape versus how much is currently engineering-specific:

**Already domain-agnostic in its actual data model:**
- `KnowledgeObject` (`src/knowledge/types.ts`) has no engineering-specific fields — `title`, `content`, `state`, `confidence`, `corroborations`, `tags`. A `ComparableSale` or `PlanningPermission` fits this shape today without a schema change.
- The Topology Graph (`docs/org_graph_architecture.md` §4, `src/cloud/types.ts`) already models `CloudTopologyService.serviceType` as a free string and topology edges as `{fromType, fromId, toType, toId, edgeType, basis}` — a `Property --located_in--> Region` edge fits the same shape as `Repository --depends_on--> Service`.
- The Trust Model (ADR-008, `trust_model.md`) is explicitly about organisational evidence accumulation, not code — it never assumed the thing being trusted was a finding about software.
- Every "Bring Your Own X" primitive in `docs/future_primitives_brainstorm.md` and ROADMAP M18 (BYOR) reads differently in retrospect: they were never engineering features. BYOR is "register a runtime," BYOK is "register a knowledge source," Bring Your Own Models is "register a model" — none of that logic cares what domain is calling it. They're platform services that happened to get designed inside an engineering-flavored repo. Good abstractions tend to survive contact with a second, unrelated domain without needing to change shape; this is the first real test of that for anything built here.

**Currently engineering-specific, would need an extension boundary drawn:**
- Captains and Personas (`src/captains/`, `src/commands/personas.ts`) are engineering-flavored today — a "security-reviewer" persona, `git`-shaped context packs. The Captain *execution* concept generalizes; the specific Captains shipped don't.
- Blueprint manifests (`src/blueprints/types.ts`) currently assume `includes.personas`/`includes.captainTasks` and repo-relative paths — the registry/publish/install mechanism generalizes, the manifest schema would need domain-neutral fields.
- Mission Control's UI (`ui/src/components/*View.tsx`) renders engineering nouns directly in component code (Captains, Repositories, Blueprints) rather than through a generic node-type renderer — this is the biggest actual engineering lift if this direction is ever pursued, not the data model.
- The indexing/search pipeline (`src/indexing/`) is built around source files and git repos specifically — the part of ctxhub with the least obvious generic analog for a domain like property investing.

## 6. A second capability this unlocks: organisational conversation

Separate from the runtime/extension architecture, the same primitives (identity, trust, policy, scoped knowledge) point at a second product surface: a conversational layer that understands an organisation's boundaries, not just its content. This section sketches it as a capability the runtime unlocks; it's substantial enough that it likely deserves its own design document if it's ever pursued seriously, rather than staying a subsection here — flagged, not written yet.

The pattern: customer question → identity resolution → policy/data-boundary check → organisation-aware retrieval → evidence-backed answer → human escalation when confidence is low → learning signal captured (a candidate finding, reviewed before it becomes reusable — never "the model just remembers what the customer said"). The same underlying knowledge produces different answers depending on who's asking: a DealLedger investor might get a full risk breakdown on a property; a public visitor gets a safe preview; a sourcer gets told what's missing before the deal can publish. Configuration would look like a per-audience policy document — knowledge scopes, minimum trust tier, allowed actions, actions requiring approval, and a learning workflow — rather than a hand-built chatbot flow per surface.

This matters commercially because most companies want an AI chatbot and are nervous about exactly the failure modes ctxhub's existing design already treats as first-class problems: hallucination, access control, data leakage, inconsistent answers, poor provenance, no audit trail, no safe learning mechanism. The pitch becomes "deploy conversational AI that understands your organisation without ignoring its boundaries" rather than "add a chatbot to your website" — a materially different, stronger claim, and one the identity/trust/policy work already done this session is most of the way to substantiating. Applied across DealLedger alone, the same runtime capability would power an investor portal, a supplier portal, the public website, support, and an internal knowledge assistant — five surfaces from one capability, which is itself a small piece of evidence for §1's argument.

## 7. Naming implications

This reframes rather than just narrows the naming search already sitting paused in `NAMING_CANDIDATES.md`. If "ctxhub" (the current product) is really one *application* on a runtime — the VS Code-to-Electron relationship — the naming decision splits into two separate questions that a single name search was trying to answer at once:

- **The platform/runtime name** — needs to be domain-neutral. Most of `NAMING_CANDIDATES.md`'s three rounds lean on dev-tool or repo metaphors (RepoWeave, RepoThread, ctxmind, kairowise) precisely because they were optimizing for "sounds like a coding tool" — the wrong target if the name has to cover property investing and whatever comes after that too.
- **The extension/product name** — "ctxhub" itself could simply keep its current name as the engineering extension's product identity, the way "VS Code" doesn't need to solve for meaning "text editor built on a cross-platform app shell." That would sidestep the `andrewyng/context-hub` collision that started the naming search in the first place, rather than requiring a workaround for it — the collision only matters if "ctxhub" has to be the company/platform name; it matters much less as one product name among several.

Not resolved here — flagged so the paused naming work picks it up with the right framing rather than restarting from the wrong premise.

## 8. Explicitly not decided by this document

- Whether to actually build this. That's a business decision (does DealLedger's timeline and ctxhub's need to stay focused on VF3/the enterprise milestones support splitting effort now, or does one product need to prove itself alone first) as much as a technical one.
- Any rename. `NAMING_CANDIDATES.md` stays paused; this only changes what future naming work should optimize for.
- Any ROADMAP.md milestone. This is a different category of decision than a numbered milestone — it's about whether "ctxhub the product" is the right frame going forward, not a feature within that frame. It doesn't get an M-number until there's alignment that it's happening.
- Which extension boundary is correct in practice. §5's assessment is a first pass; actually drawing the line between "platform" and "engineering extension" is real design work that would need to happen with a working DealLedger prototype in front of it, not from this document alone.

## 9. What would need to be true before this is more than a document

The premature-abstraction risk here is real and worth naming plainly: there is currently exactly one production consumer of everything described in §5 (ctxhub itself), and DealLedger's own maturity, timeline, and actual technical needs aren't things this document has visibility into. Extracting a platform from a single real usage is speculative generalization — the same mistake ADR-009 and ADR-013 already warn against elsewhere in this codebase, just at a company-strategy scale instead of a feature scale. The version of this worth trusting is: DealLedger reaches the point of needing its own Knowledge Objects / Workers / Mission Control, at which point building it as a second real consumer of the *existing* ctxhub primitives (even informally, even before any "Extension SDK" exists) is the actual evidence-gathering step — not a formal runtime extraction done in advance of that.

## 10. Success criteria

This runtime should only be treated as real once it can demonstrate all of the following — and reconsidered if any of them stops being true later:

1. At least two genuinely different applications consume the same platform primitives.
2. Neither application needs to compromise its domain model to fit the platform.
3. The platform removes duplicated implementation rather than introducing indirection that wasn't there before.
4. Platform evolution benefits every application without forcing domain-specific changes into the runtime.
5. The runtime stays opinionated about organisational intelligence — identity, knowledge, trust, execution — and never about any particular industry.

*ctxhub Platform Runtime · v2 · Draft · July 2026*
