# ADR-007 — Cascade rules are derived from topology edges, not manually configured

**Date:** July 2026  
**Status:** Accepted

## Context

Cascade rules determine when a captain run finding in one workspace should trigger a captain run in another workspace. The naive design is to make cascade rules a manually configured relationship: an admin explicitly says "findings in workspace A should cascade to workspace B."

Manual configuration is brittle: it requires admins to know the dependency graph, keep it in sync as dependencies change, and repeat configuration for every new workspace pair. If the topology graph already captures dependency relationships (via `depends_on` edges), duplicating that information in cascade rules is redundant and creates inconsistency.

## Decision

**Cascade rules are automatically derived from Engineering Topology Graph `depends_on` edges. When a `depends_on` edge is created, a cascade rule is created. When it is removed, the derived cascade rule is removed.**

The `cascade_rules` table has a `basis` field:
- `"topology"` — derived from a `depends_on` topology edge; lifecycle is tied to that edge via `topology_edge_id` FK
- `"manual"` — explicitly configured by an admin; persists independently of topology changes

When a `depends_on` edge is added (Workspace A → Workspace B):
- A `cascade_rule` is automatically created: `source=A, target=B, basis="topology", trigger="captain.run.promoted"`
- Default trigger: a promoted finding in A causes the same captain task to run in B

When a `depends_on` edge is removed:
- All `cascade_rules` with `basis="topology"` and `topology_edge_id` pointing to that edge are deleted
- `basis="manual"` rules are never auto-deleted

Admins may still create manual cascade rules to override defaults (different trigger condition, specific captain task filter, or a cascade between workspaces that do not have a `depends_on` relationship).

## Consequences

**Positive:**
- Zero-configuration cascade: add a dependency edge and propagation is automatic
- Topology is the single source of truth for dependency relationships — no duplication
- Removing a dependency removes the cascade — no stale rules accumulating over time
- Manual overrides are still possible for fine-grained control

**Negative:**
- Auto-derived cascades may be surprising if an admin adds a `depends_on` edge without expecting cascade side effects (mitigated by surfacing cascade rules clearly in the UI)
- Cascade derivation logic is a background side effect of topology mutations — must be transactional to avoid orphaned rules

**Constraint to preserve:**
The default cascade trigger for auto-derived rules is `captain.run.promoted`. Do not change this default without considering the blast radius — every `depends_on` edge in the topology graph produces a cascade rule with this trigger.
