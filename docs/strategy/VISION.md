# ctxhub — Long-Term Vision & Monetisation Strategy

*Internal document. Not for public distribution.*

---

## The mission

Turn every engineering decision into institutional knowledge.

*Internal slogan: Knowledge compounds.*

---

## Three statements, three purposes

These are not competing ideas. They operate at different levels. Use the right one for the right context.

| Level | Statement | Use when |
|---|---|---|
| **Mission** — why we exist | "Turn every engineering decision into institutional knowledge." | Evaluating product decisions internally |
| **Product promise** — what users experience | "Make every AI agent understand your codebase." | README, homepage, Hacker News |
| **Company vision** — where we're heading | "Build the operating system for AI engineering teams." | Investors, advisors, team |

The mission is the test for every product decision. The product promise is what goes on the homepage. The company vision is what goes in the board deck. Keep them in their lanes.

---

## The one-line summary

Open-source the runtime. Sell the coordination.

---

## Principles

Three principles. Every product decision should be testable against them.

**Open context** — Context infrastructure is more valuable when it's universal. The runtime is open source because context that's locked to one vendor isn't infrastructure, it's a moat for someone else.

**Humans stay in control** — AI proposes. Humans approve. The value of the approval queue isn't bureaucracy — it's trust. Each approval is a data point that the AI's judgment can be relied on a little more next time.

**Knowledge compounds** — Every engineering decision should make future engineering decisions better. If a feature doesn't contribute to that loop, it probably doesn't belong in ctxhub.

---

## The architecture

Three concentric layers. Each one stable. Each one expandable without changing the others.

```
        AI Models
(Claude, Codex, GPT, Ollama…)
              ▲
       ctxhub Runtime
(Context, Memory, Personas, Index, MCP)
              ▲
      Mission Control
(Fleet, Captains, Missions, Reviews, Analytics)
```

The runtime is the context layer — everything that gives AI agents a shared, structured understanding of your codebase. Mission Control is the coordination layer — everything that lets humans and agents work together with visibility and approval. The models are interchangeable execution engines underneath both.

That separation is the product's structural advantage. New models arrive, the runtime gets smarter, Mission Control gets more useful. Nothing about the architecture changes.

---

## The AI Workforce

Every engineering organisation now has two workforces.

Human engineers. AI engineers.

Mission Control manages the second one.

That framing explains every feature in the product:

- **Fleet** — the overview of your AI workforce
- **Captains** — agents assigned to ongoing responsibilities
- **Missions** — coordinated work across multiple agents
- **Personas** — roles and specialisations for different agents
- **Approvals** — humans staying in the loop on significant decisions
- **Eval** — quality assurance for what the AI workforce produces
- **Memory** — institutional knowledge that persists across the workforce

People already understand how to manage a human workforce. Mission Control applies the same concepts to AI agents. That's why the vocabulary feels intuitive rather than novel.

---

## The context layer

MCP, Memory, Personas, Skills, Missions, the Knowledge Graph, the Index — these are all one thing. They're context.

ctxhub is the context layer for AI engineering. Every feature in the runtime exists to give AI agents the right context at the right time: what the codebase contains, what the team has decided, what was reviewed and approved, what the architecture looks like, who owns what.

That framing unifies the whole product. It also explains why the runtime should be open source — context infrastructure, like network infrastructure, is more valuable when it's universal.

---

## Where we are

ctxhub started as a developer tool for shared codebase context. After building Mission Control — Fleet, Captains, Missions, Personas, Eval, Memory, Webhooks, Execution Profiles — it's something different.

It's becoming the coordination layer for AI-first engineering teams.

That's a meaningfully different category, and it changes how to think about what this is worth and to whom.

---

## The company in one paragraph

ctxhub is the open-source context layer that gives AI agents a shared understanding of an engineering organisation. Mission Control is the commercial coordination layer that manages how engineering knowledge is created, reviewed, trusted, and accumulated through an AI workforce.

The agents are the mechanism. The knowledge is the asset. The orchestration exists to build the moat.

More precisely: the asset isn't just knowledge — it's **institutional judgement**. Not only what decisions were made, but *how this specific organisation makes decisions*: which reviews get accepted, which trade-offs consistently get approved, which personas a team has learned to trust. That pattern is encoded in every Captain finding promoted, every Mission output preserved, every approval recorded. A competitor can copy the indexing. They cannot copy two years of your organisation's reasoning.

---

## The mental model: Nx + Nx Cloud

The closest analogy is Nx and Nx Cloud.

| Nx | ctxhub |
|---|---|
| Coordinates builds | Coordinates AI agents |
| Understands project graph | Understands code + architecture + memory |
| Incremental computation | Incremental indexing and context |
| Task pipelines | Missions |
| Nx Cloud coordinates CI | Mission Control coordinates AI workflows |
| Remote cache | Shared knowledge and memory |
| Distributed execution | Multi-agent execution |

Nx gives away the powerful local tool for free. Nx Cloud monetises the collaboration and scale that teams need. The OSS tool drives adoption; the cloud product monetises it.

ctxhub can follow the same pattern — with one meaningful difference. Nx optimises builds. ctxhub captures and operationalises engineering knowledge. Knowledge compounds in a way that build speed doesn't. The long-term asset is stronger.

The Nx comparison is useful internally for explaining the open-core strategy. Don't overuse it publicly — the problem space is broader. "Inspired by Nx's open-core model" is accurate; "Nx for AI" undersells the scope.

---

## The two products

### 1. ctxhub (Open Source)

Everything an individual developer needs. Free forever.

- CLI
- MCP server
- Local index (LanceDB)
- Local memory / MemPalace
- Mission Control (core)
- Captains
- Missions
- Personas
- Execution profiles
- Eval harness
- Webhook triggers

This is the tool you've built for yourself. Open-sourcing it builds trust, drives adoption, and positions the runtime as infrastructure — not a product you need to sell.

### 2. Mission Control Cloud / Pro

This is where teams pay. The value isn't AI — it's coordination.

**Pro (individual, ~£15–25/month)**
- Mission history and replay
- Sync across machines
- Notifications and alerts
- Enhanced UI and analytics

**Team (~£20–40/user/month)**
- Shared Mission Control workspace
- Shared knowledge graph
- Shared memory and personas
- Review queues and approval workflows
- Role-based access control (RBAC)
- Team dashboards
- SSO

**Enterprise (custom)**
- Self-hosted
- On-premises deployment
- Compliance and audit logs
- Custom connectors
- SLA and support

---

## What people actually pay for

The mistake is charging for search. Everyone expects search to be free.

The thing teams will pay for is coordination:

- **Visibility** — what are my agents doing right now, and what did they do yesterday?
- **Shared knowledge** — when a new engineer joins, they inherit two years of AI-reviewed architectural decisions, security findings, ADRs, and design rationale
- **Approval workflows** — a human stays in the loop on every significant AI decision
- **Audit trails** — the manager who asks "what did the AI actually do last week?" gets an answer

Mission replay is probably the highest-value individual feature. Being able to rewind yesterday's agent activity — what ran, what it found, what was approved, what was merged — is something engineering managers will pay for independently.

---

## Who buys

**Not initially:** Solo developers. They're happy with Cursor and Claude. The local OSS runtime serves them well.

**Primary target: AI power users.** People running Claude, Codex, Cursor, Ollama, and OpenRouter simultaneously. They feel the coordination pain acutely. They'll pay early and give the best feedback.

**Sweet spot: Small engineering teams (5–30 engineers).** A 12-person startup where everyone uses different AI tools, nobody documents properly, and AI forgets everything between sessions. Mission Control suddenly becomes the morning dashboard every engineer opens.

**Long-term: Enterprise.** They care about data staying on-prem, approval workflows, audit trails, permissions, and compliance. The local-first architecture is already positioned correctly for this.

---

## The marketplace

Once there's a community of users, personas and workflow packs become installable:

```bash
ctxhub install security-pack
ctxhub install aws-architecture-reviewer
ctxhub install next-js-reviewer
ctxhub install pci-compliance-pack
```

Community-published packs. Curated official packs. Enterprise-verified packs. This is the extension model that turns ctxhub from a tool into a platform.

A persona pack isn't just a prompt — it's a complete execution context:
- System prompt and reasoning style
- MCP tool permissions
- Model and provider binding
- Memory room scope
- Approval rules
- Relevant skills

That's installable, shareable, and versionable. It's the thing that makes ctxhub extensible beyond what any single team can build.

---

## The cloud sync angle

```bash
npm install -g ctxhub     # works today
ctxhub cloud login        # unlocks the platform
```

Once authenticated:

- Sync personas, memories, missions, and captains across machines
- Install community-published personas and workflows
- Share knowledge graphs with teammates
- Access Mission Control from anywhere

This is the moment ctxhub stops being a local tool and becomes a platform. The CLI stays local. The coordination moves to the cloud.

---

## The two flywheels

ctxhub runs two compounding loops simultaneously.

**The knowledge loop** — every decision captured makes the next decision easier:

```
Engineer works
        ↓
AI assists
        ↓
Decision approved
        ↓
Knowledge stored
        ↓
Future AI starts informed
        ↓
Better decisions, faster
        ↓
More knowledge
```

**The trust loop** — every approval extends the AI's autonomy a little further:

```
AI helps with something small
        ↓
Human approves
        ↓
Confidence grows
        ↓
More responsibility delegated
        ↓
AI handles something larger
        ↓
Human approves again
        ↓
Trust deepens
```

Mission Control is primarily the trust loop made visible. The approval queue, the Captain runs, the promotion workflow — they all exist to give humans legible control over how much they're relying on AI, and to build confidence incrementally rather than all at once.

The knowledge loop is the moat — it keeps customers. The trust loop is the product experience — it gets customers. Both compound. Neither resets.

Each approved review, promoted ADR, and Captain finding makes the next one more accurate. The index gets sharper. The memory gets richer. The personas get better calibrated to how this specific team thinks. This is the mechanism that turns a useful tool into an essential one.

**Why both matter together.** Knowledge compounds. Trust compounds. The first creates institutional memory. The second creates confidence. Together they turn occasional AI assistance into an engineering capability that improves over time.

---

## The data moat

Every team using ctxhub is accumulating something competitors can't copy — not just institutional knowledge, but institutional judgement.

Not just the decisions themselves, but which reviews were accepted, which findings were promoted, which personas worked well, how this specific organisation makes engineering decisions under uncertainty. That's the layer above knowledge. It's harder to articulate and much harder to reproduce.

Every approved review. Every promoted ADR. Every mission output. Every security finding. Every architecture decision. Every Captain run.

Over months and years this becomes structured institutional engineering knowledge — not stored in someone's head, not buried in Slack, not forgotten when an engineer leaves. Searchable, attributable, and compounding.

This is the moat. Not proprietary models. Not a better search algorithm. The accumulated knowledge of how a specific engineering organisation thinks, decides, and works.

A competitor can copy the indexing. They can't copy two years of your team's architectural decisions.

---

## The bigger framing

The industry is moving from AI chat to AI teammates. That shift makes the timing unusually good.

A useful hierarchy of analogies:

- Git → source of truth for code
- GitHub → collaboration around code
- ctxhub → collaboration around AI knowledge

GitHub didn't compete with Git. It made Git more valuable by adding the collaboration layer. ctxhub doesn't compete with Claude, Codex, or Cursor. It makes all of them more valuable by adding shared context, memory, and coordination.

That model-agnostic position is a structural advantage. Whatever models dominate in two years, ctxhub remains valuable because it sits above the model layer.

---

## The real competitor

In the near term, the comparison is Cursor, Copilot, Claude. But those are AI tools. ctxhub sits above them.

The more interesting long-term competitor is Atlassian.

Engineering organisations currently store knowledge across Confluence, Jira, Slack, Notion, ADR folders, wikis, random Markdown files, and engineers' heads. None of it is connected. None of it is searchable by an AI. None of it compounds.

ctxhub's answer: the AI generates, organises, and surfaces that knowledge automatically — connected to the code that produced it, attributed to the decision that approved it, searchable forever.

That's a much larger market than "developer tools."

---

## What not to build

- Another IDE
- Another coding assistant
- Another model provider

Competing directly with Cursor, Copilot, or Anthropic is the wrong fight. Stay focused on the coordination layer. Let the model providers compete with each other. ctxhub becomes more valuable as the number of AI tools increases, not less.

---

## The endgame (two distinct products)

**ctxhub** — the developer platform. OSS runtime with Pro sync and history. Strong individual and small-team appeal.

**Mission Control Cloud** — the team platform. "GitHub for AI engineering operations." Where teams collaborate, review AI output, share knowledge, and manage their AI workforce. Enterprise-ready. The long-term commercial opportunity.

These can launch as one product and split later as the market clarifies. The architecture already supports both.

---

## Why this might actually work

Every commercial decision in ctxhub has come from real pain:

- Spec-driven development across multiple repos
- Multiple AI models with no shared context
- AI forgetting everything between sessions
- Reducing token costs through better indexing
- Long-lived memory for architectural decisions
- Shared context across a team

That's why the product feels coherent rather than like a list of trendy AI features. Coherence is rare and hard to manufacture. It's the most important thing to protect as the product grows.

Build it because it's the workflow you want. That's the route most likely to work commercially.

---

## Why won't GitHub, Anthropic, or Cursor just build this?

They could. But their incentives point elsewhere.

GitHub wants GitHub. Anthropic wants Claude. Cursor wants Cursor. Each has a strong reason to keep you inside their ecosystem.

ctxhub's position is explicitly model-agnostic and platform-agnostic. It gets more valuable as the number of AI tools increases — more agents to coordinate, more decisions to capture, more context to share. A company whose revenue depends on one model provider can't credibly take that position.

The honest answer is: they might eventually. The strategic answer is: by then, the knowledge flywheel will have been running for years, and the institutional knowledge accumulated by ctxhub users would represent a significant switching cost.

---

## The core metric

Every great infrastructure company has one. GitHub counts repositories. Docker counts containers. Kubernetes counts clusters.

ctxhub's is **Knowledge Capture Rate** — the percentage of significant engineering decisions that are captured, structured, and searchable.

```
Engineering Knowledge — this week

  Knowledge Capture Rate     93%

  27  decisions reviewed
  14  Captain findings promoted
   6  ADRs generated
   4  security findings resolved
   2  architecture changes documented
```

This metric is directly tied to the mission: "Turn every engineering decision into institutional knowledge." When the rate goes up, the mission is working. When it drops, something is wrong with the workflow.

It's also the metric that makes the data moat legible. A team can look at two years of weekly capture rates and immediately understand what they'd be giving up by switching.

---

## Near-term priorities (before charging anyone anything)

1. **Polished screenshots and a 90-second demo video** — the press release promises something ambitious; the demo has to deliver it
2. **Stable local experience** — indexing, Captains, and Missions need to be reliable enough that users trust them
3. **OSS launch** — GitHub, Hacker News, developer communities
4. **Collect power users** — find the people running multiple AI tools simultaneously; they'll tell you exactly what to build next
5. **Mission replay** — the single feature most likely to justify a Pro tier

The monetisation model is clear enough to build toward. The priority now is making the product as good as the press release says it is.

---

## Appendix: What ctxhub isn't

People will project assumptions. Having the answers ready matters.

| Assumption | Answer |
|---|---|
| Another IDE | No. ctxhub has no editor. It makes your existing editor's AI smarter. |
| Another AI chat interface | No. ctxhub orchestrates agents; it doesn't replace the conversation layer. |
| Another coding agent | No. Captains and Missions use agents; ctxhub coordinates them, it isn't one. |
| Another model provider | No. ctxhub is explicitly model-agnostic. It works better as more models exist. |
| Another wiki or knowledge base | No. The knowledge is generated from real engineering work, not written manually. |
| Another vector database | No. LanceDB is an implementation detail. ctxhub is the layer above the index. |
| A replacement for engineers | No. The trust loop requires human approval by design. AI proposes; humans decide. |

When in doubt, return to the mission: *Turn every engineering decision into institutional knowledge.* If a proposed feature or comparison doesn't serve that, it probably doesn't belong.
