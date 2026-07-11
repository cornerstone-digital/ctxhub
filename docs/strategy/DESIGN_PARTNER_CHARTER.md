# Founding Design Partner Charter

**ctxhub × VodafoneThree Engineering**

*Version 1.1 — Draft for discussion*

---

## Purpose

This charter establishes VodafoneThree Engineering as a Founding Design Partner for ctxhub. The goal is mutual: VodafoneThree gains early access to a context layer for AI-native engineering and direct influence over its roadmap. ctxhub gains a serious engineering organisation as a real-world test environment, and honest feedback before features become commitments.

This is not a customer relationship. A customer buys what's on the shelf. A design partner helps decide what goes on the shelf.

---

## Duration

Six months from the agreed start date. Renewable by mutual agreement. Commercial terms for continuation are discussed before the pilot concludes — not after.

---

## VodafoneThree commits to

- **A named technical champion** — an engineer or engineering leader who uses ctxhub day-to-day and owns the feedback relationship
- **Access to engineers** — structured access to engineers across seniority and function: junior, senior, and principal engineers; platform engineering; security team. They will each use ctxhub differently, and we need to hear from all of them, not only from the champion
- **Weekly feedback** — brief written or verbal update on what's working, what isn't, and what's missing
- **Monthly roadmap review** — 30-minute session to review upcoming features and validate priorities against real requirements
- **Honest failure reporting** — when things break, we need to know quickly and in detail; silence is not useful

---

## ctxhub commits to

- **Roadmap influence within ctxhub's platform principles** — VodafoneThree's requirements are treated as first-class input; where they represent broadly applicable enterprise needs, they move up the priority queue. VodafoneThree influences the roadmap; it does not direct it. Requirements that conflict with ctxhub's core principles (local-first, open context, humans in control) will not be implemented, and that boundary is honest and mutual
- **Priority engineering access** — bugs affecting the pilot are addressed before general issues
- **A dedicated communication channel** — direct access for the technical champion; no ticketing system
- **Transparency** — honest about timelines, limitations, and what isn't built yet
- **No production SLA** — this is a pilot environment; there is no uptime guarantee, no support SLA, and ctxhub should not be relied upon for production engineering workflows during the pilot period

---

## Pilot environment

- Deployed to VodafoneThree infrastructure as a single-tenant installation
- **Source code never leaves VodafoneThree machines** — this is a structural guarantee, not a policy claim. The ctxhub runtime indexes and stores codebase content locally. No source code, no indexed content, and no Captain findings are transmitted to ctxhub infrastructure at any point during the pilot
- The Cloud coordination layer (in development) operates on a push-based model: VodafoneThree's machines initiate all connections; ctxhub infrastructure never polls or accesses local machines
- The pilot environment is isolated from any VodafoneThree production systems

---

## Data and intellectual property

- VodafoneThree retains full ownership of all code, data, findings, and knowledge created or processed during the pilot
- ctxhub retains ownership of the platform, its codebase, and all software developed
- Feedback, feature requests, and requirements provided by VodafoneThree during the pilot do not transfer ownership of any resulting features or intellectual property to VodafoneThree
- Neither party will disclose confidential information belonging to the other without prior written consent

---

## What success looks like

Success for this pilot is defined before it starts, not after. Before the pilot begins, both parties agree on a specific answer to:

*"If this pilot works perfectly, what does VodafoneThree's engineering organisation look like in six months that it doesn't look like today?"*

That answer becomes the measure. Progress is reviewed monthly against it.

### Pilot success metrics

These are the objective measures tracked through each monthly review:

| Metric | What it measures |
|---|---|
| Active engineers | How many engineers are using ctxhub at least once per week |
| Captain runs per day | Velocity of AI-driven analysis across the pilot orgs |
| Promotion rate | Fraction of Captain findings promoted to institutional knowledge (Knowledge Capture Rate) |
| Mission Control opens | Engagement with shared visibility across orgs |
| Engineer NPS | Would the engineers using ctxhub recommend it to peers? |
| Engineers who would continue | At pilot end: how many engineers would keep using ctxhub if it stopped tomorrow? |

Baseline is measured at week two of the pilot (to allow for setup). Targets are agreed between both parties before the pilot begins.

---

## Founding Partner Licence

VodafoneThree's commercial relationship with ctxhub follows a four-stage model:

```
£0          → Pilot (six months)
↓
Founding Partner pricing  → locked for 24 months post-pilot
↓
Public pricing
```

As a Founding Design Partner, VodafoneThree receives:

- **Lifetime Founding Partner status** — recognised in ctxhub's documentation, changelog, and public materials (with VodafoneThree's permission)
- **Roadmap Council seat** — standing invitation to quarterly roadmap reviews alongside ctxhub's product team
- **Annual strategy session** — one dedicated session per year to align ctxhub's roadmap with VodafoneThree's engineering direction
- **Early access previews** — access to features before public release, with input rights during the preview period
- **Founding Partner pricing** — enterprise licence pricing locked for 24 months from the pilot conclusion date; specific pricing agreed before the pilot begins

This is not a discount on public pricing. Founding Partner pricing is a separate, pre-public tier that reflects VodafoneThree's role in shaping the platform.

**No obligation:** either party may exit the pilot with 30 days' written notice; there is no obligation to proceed to a commercial arrangement.

---

## What this is not

- A production deployment
- A commitment to build any specific feature
- A guarantee that features requested during the pilot will ship, or ship on any particular timeline
- An exclusive arrangement — ctxhub may work with other design partners simultaneously

---

## Review cadence

| Cadence | Format | Owner |
|---------|--------|-------|
| Weekly | Written update from technical champion | VodafoneThree |
| Monthly | 30-minute video call — metrics review + roadmap alignment | Both |
| End of pilot | Structured review: what worked, what didn't, commercial discussion | Both |

---

## Signatures

| | ctxhub | VodafoneThree |
|---|---|---|
| **Name** | | |
| **Title** | | |
| **Date** | | |

---

*This charter is a statement of intent and mutual commitment. It is not a legally binding contract. Where a formal agreement is required, this document forms the basis for a short-form legal agreement to be drafted by appropriate counsel.*
