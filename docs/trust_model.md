# ctxhub Trust Model

*Related: [Identity Model](./ctxhub_identity_model.docx) · [Cloud Architecture](./cloud_architecture.md) · [Org Graph](./org_graph.md) · [ADR-001](./adr/ADR-001-event-driven-architecture.md)*

---

## Why trust is the foundational concept

Every major feature in ctxhub is, at its core, a question about trust.

- **Mission Control** trusts that the events it displays are accurate records of what happened
- **Captains** trust that the findings they surface are worth surfacing — but explicitly do not trust that they are correct enough to act on without human review
- **Promotion** is the moment trust is explicitly granted: a human decides that a finding is trustworthy enough to become institutional knowledge
- **Knowledge Objects** are promoted findings — things the organisation has decided to trust
- **Enterprise Governance** is the set of controls that determines who can trust what, and under what conditions
- **Federation** is an agreement to extend trust across organisational boundaries

This document describes the trust model that unifies these features — not as a security model (see [Security Architecture Brief](./strategy/SECURITY_ARCHITECTURE_BRIEF.md)) but as a conceptual model for understanding how trust is established, granted, verified, and withdrawn across the system.

---

## What trust means in ctxhub

In ctxhub, **trust is the belief that a piece of information is accurate, relevant, and safe to act upon without further verification**. Trust is always contextual: a finding that is trusted for exploration may not be trusted for a production decision; a finding trusted by one team may not be trusted by another.

Trust in ctxhub has three dimensions:

| Dimension | Question | Example |
|---|---|---|
| **Source trust** | Where did this come from? | Captain output vs human annotation vs external import |
| **Scope trust** | Who is this trusted by, and for what? | Workspace-level vs org-level vs group-level |
| **Temporal trust** | How long is this trusted? | A finding from last week vs institutional knowledge from two years ago |

---

## The trust hierarchy

```
Unverified (raw agent output)
    ↓
Reviewed (human has seen it; no action taken)
    ↓
Promoted (human has decided this is worth keeping)
    ↓
Institutional Knowledge (promoted + aged + referenced)
    ↓
Canonical (explicitly designated as authoritative)
```

Every piece of information in ctxhub has a trust level. Movement up the hierarchy requires explicit human action. Nothing is automatically promoted, automatically designated canonical, or automatically acted upon.

**The system can suggest upward movement. Only humans can execute it.**

---

## What can be trusted automatically

Some things in ctxhub are trusted without human review, because the act of producing them is itself the evidence:

| Item | Trusted automatically | Why |
|---|---|---|
| Index event (file indexed at time T) | Yes | It happened; it's a fact |
| Captain run started/completed | Yes | System event; factual |
| Member logged in | Yes | System event; factual |
| Permission granted/revoked | Yes | System event; factual |
| File existed at commit hash | Yes | Git is the source of truth |

These are **facts**, not **interpretations**. Facts can be trusted automatically because they are recorded, not inferred.

---

## What requires human approval before trust is extended

Interpretations — things produced by reasoning about facts — require human review before trust is extended:

| Item | Why human approval is required |
|---|---|
| Captain finding | LLMs make mistakes; a finding is a hypothesis, not a conclusion |
| Promoted note | The act of promotion is the explicit trust grant |
| Architecture recommendation | Consequences may be significant; human context is required |
| Cross-org knowledge share (Corporate Group) | Extending trust across an organisational boundary requires a human decision |
| Federation agreement | Extending trust across a company boundary requires explicit mutual commitment |
| Security classification change | Changing what is visible to whom requires human authorisation |

---

## Who decides

Trust grants at each scope level require a principal at that level or above:

| Decision | Minimum required role |
|---|---|
| Promote a finding to knowledge | member |
| Designate a knowledge object as canonical | admin |
| Grant a machine token | admin |
| Share a workspace with the org | admin |
| Share org knowledge with the group | group-admin |
| Approve a Federation agreement | owner |
| Revoke trust (demote, delete, revoke) | Same role as grant, or higher |

Trust cannot be escalated by automation. A Captain cannot promote its own findings. A sync process cannot grant cross-org access. A machine token cannot modify RBAC.

---

## What evidence is required

Trust grants are not arbitrary — they are recorded decisions attached to evidence. The audit log captures:

- **Who** granted the trust (actor identity)
- **What** was trusted (resource — finding, knowledge object, permission)
- **When** (timestamp)
- **Why** (optional: the human's annotation at the time of promotion)
- **What evidence supported it** (the Captain run ID, the source commits, the query that produced the finding)

This means trust decisions are **reproducible**: a future reviewer can trace any knowledge object back to the finding that produced it, the Captain run that surfaced it, the commits that informed it, and the human who promoted it.

---

## How trust changes over time

Trust is not permanent. Three forces erode it:

**1. Staleness.** A finding about a codebase from six months ago may no longer reflect the current state. ctxhub tracks the last-indexed commit for each workspace and surfaces staleness warnings on knowledge objects when the underlying code has changed significantly since promotion. A knowledge object that references a file that has been substantially rewritten is flagged for review, not silently trusted.

**2. Contradiction.** A new Captain finding may contradict an existing knowledge object. When this happens, the contradiction is surfaced to the owner of the knowledge object for resolution — the system does not silently overwrite trusted knowledge.

**3. Explicit revocation.** A human can demote or delete a knowledge object at any time. Deletion is logged; the event record (that the object existed and was deleted) is preserved even if the object itself is gone.

---

## Trust across organisational boundaries

### Within a workspace (default)

A promoted finding is trusted by members of the workspace. Other workspaces in the same org can see it exists (via Org Graph) but cannot read its content without explicit sharing.

### Within an organisation

An admin can share a workspace's knowledge with the broader organisation. Once shared, all org members can query it. Org-level trust does not flow to sub-workspaces automatically.

### Within a Corporate Group

A group-admin can configure cross-org knowledge sharing for specific knowledge types within the group. This is explicit, per-type configuration — not a global permission. A finding shared at group level is visible to group admins and the member orgs they configure, but is not queryable outside the group boundary.

### Across a Federation

Federation is an agreement between two independent organisations to exchange anonymised knowledge signals. What is shared is not the knowledge object itself but a derived signal — "organisations like yours have encountered this pattern." Individual identity, specific code, and specific findings are not shared across a Federation boundary. The trust model for Federation is described in [M13 — Federation](../ROADMAP.md).

---

## Trust and automation

ctxhub uses automation extensively — scheduled Captains, nightly indexing, event-driven sync — but automation in ctxhub has a specific constraint: **automation can produce, but cannot promote**.

| Automation can | Automation cannot |
|---|---|
| Run a Captain task | Promote a Captain finding |
| Index a workspace | Modify RBAC |
| Sync events to Cloud | Grant cross-org access |
| Suggest a knowledge object needs review | Mark it as canonical |
| Flag a staleness condition | Resolve it |
| Propose a cascade run in another org | Trigger it without human approval |

This is the boundary that "Humans Stay in Control" (from [PRINCIPLES.md](../PRINCIPLES.md)) imposes on the trust model. It is not a limitation of the automation — it is the design.

---

## Trust and the Engineering Flywheel

The compounding effect in ctxhub's [Engineering Flywheel](../ROADMAP.md) is a trust compounding effect:

1. A developer runs a Captain. A finding is produced. **Unverified.**
2. A developer reviews it and promotes it. **Promoted — trusted at workspace level.**
3. It is shared with the org. Other developers reference it. **Trusted at org level.**
4. It surfaces in a Corporate Group query. Another org finds it useful. **Trusted at group level.**
5. A anonymised signal from it contributes to a Federation pattern. **Trusted at industry level.**

Each promotion step is a trust grant. The flywheel compounds because trust, once granted, can be shared and built upon — but it can only be granted by a human.

---

## Relationship to other documents

| Document | How it relates to the Trust Model |
|---|---|
| [Identity Model](./ctxhub_identity_model.docx) | Defines who the principals are — the **who** in trust decisions |
| [Security Architecture Brief](./strategy/SECURITY_ARCHITECTURE_BRIEF.md) | Defines the technical controls that enforce trust boundaries |
| [Cloud Architecture](./cloud_architecture.md) | Defines how trust decisions propagate across the sync boundary |
| [Org Graph](./org_graph.md) | The queryable surface of the trust graph — what knowledge is visible at what scope |
| [PRINCIPLES.md](../PRINCIPLES.md) | The source of the constraint that automation cannot promote — "Humans Stay in Control" |
| ADRs | Individual trust boundary decisions recorded as architectural decisions |

---

## Open questions

These are the trust model questions that remain unresolved and will require decisions as the platform evolves:

1. **Trust decay rate.** How quickly should staleness erode trust? Should it be time-based, commit-count-based, or semantic-similarity-based?
2. **Trust inheritance.** When a knowledge object is shared at org level, does it inherit the workspace's trust grants, or start fresh at org level?
3. **Trust in Federation signals.** If an anonymised Federation signal is used to surface a finding, what is the trust level of that finding? It can't be attributed to a specific human promotion.
4. **Machine-to-machine trust.** In a CI/CD pipeline, a machine token acts on behalf of a team. If a machine-produced finding turns out to be wrong, who revokes it? The machine cannot; a human must — but which human?
5. **Group trust revocation.** If a Corporate Group relationship ends, what happens to knowledge objects that were promoted as a result of cross-org queries? Do they survive, or are they flagged for review?
