# ADR-013 — Later phases are built only when their trigger condition fires

**Date:** July 2026  
**Status:** Accepted

## Context

ctxhub has an ambitious long-term roadmap: Cloud, Organisation Graph, Blueprint Hub, cloud-side LLM execution, Engineering Intelligence, Enterprise tier. Each of these is a significant engineering investment. The risk is building phases in anticipation of demand that doesn't materialise — spending months on cloud-side execution before a single team has asked for it, or building enterprise RBAC before the first enterprise prospect appears.

The alternative is to pre-define explicit trigger conditions for each phase: observable user behaviour that must be present before building starts. A trigger is not a metric target — it is evidence that the problem the phase solves is real and present.

## Decision

**Each later phase has an explicit trigger condition. No trigger, no build.**

Defined triggers (from ROADMAP.md and strategy documents):

| Phase | Trigger condition |
|-------|-------------------|
| Cloud MVP | Teams coordinating multiple ctxhub instances manually |
| Org Graph Phase 1 | First org has promoted 50+ findings |
| Org Graph Phase 2 (pgvector) | >500 active Knowledge Objects AND semantic search is insufficient |
| Org Graph Phase 3 (graph DB) | Recursive CTE performance degrades under real load |
| Cascade / cross-workspace | Teams asking "if I fix this here, what else needs updating?" |
| Cloud-side LLM execution | Teams needing captains in CI/headless without a local service |
| Blueprint Hub | Organic sharing of personas and captain tasks without infrastructure for it |
| Enterprise tier | A real deal that cannot close without it |
| Engineering Intelligence | Leaders opening Mission Control for trends, not individual reviews |

A trigger condition is considered fired when it is directly observed — a user reporting it, a support request, a conversation in an interview — not inferred or predicted. "Probably most teams will want X" is not a trigger. "Three orgs have asked for X in the last month" is.

## Consequences

**Positive:**
- Engineering effort is allocated to problems reality has confirmed, not problems imagination has projected
- The roadmap is defensible: every phase has a clear rationale that can be pointed to
- Avoids the most common infrastructure trap: building coordination layers before anything needs coordinating

**Negative:**
- Some trigger conditions may fire unexpectedly quickly, requiring rapid response to a feature that wasn't fully designed
- The discipline requires resisting pressure to build "what we'll obviously need later" — which is harder than it sounds when the feature is technically interesting

**Constraint to preserve:**
Any proposal to start a new phase must include a statement of which trigger fired and when it was observed. "We're anticipating demand" is not a sufficient justification. If the trigger hasn't fired, the proposal should be documented as a design exploration, not scheduled for implementation.
