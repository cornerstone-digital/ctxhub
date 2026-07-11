# ADR-005 — Knowledge Objects are owned by Workspace, not by Member

**Date:** July 2026  
**Status:** Accepted

## Context

When an engineer promotes a captain run finding, two entities are involved: the Member who clicked promote, and the Workspace where the finding was discovered. The question is: who owns the resulting Knowledge Object?

Ownership has real consequences: what happens when the promoting engineer leaves the organisation? If ownership is personal, their Knowledge Objects become orphaned or must be transferred. If ownership is organisational (via the Workspace), the objects survive naturally.

This also reflects a deeper question about what kind of product ctxhub is. Is it a tool for individual engineers (personal ownership), or a platform for organisations to accumulate institutional knowledge (workspace/org ownership)?

## Decision

**Knowledge Objects are owned by the Workspace where they were discovered. The promoting Member is recorded as provenance (attribution), not as owner.**

In the data model:
- `knowledge_objects.workspace_id` — the authoritative owner; determines access scope and data lifecycle
- `knowledge_objects.promoted_by` — attribution; preserved permanently for audit and credit, even after the member is deactivated

When a Member is deprovisioned:
- Their `promoted_by` reference is preserved on all Knowledge Objects (read-only audit reference)
- Knowledge Objects remain active — they are not deleted, hidden, or transferred
- The organisation does not lose knowledge because an engineer left

When a Workspace is removed:
- Knowledge Objects enter a 90-day grace period before hard deletion
- This is a workspace lifecycle event, not a member event

## Consequences

**Positive:**
- Knowledge survives team turnover — the platform delivers on its promise of institutional memory
- Deprovisioning a member has no destructive effect on the knowledge graph
- Consistent with the product philosophy: knowledge belongs to the organisation, not individuals
- Simpler RBAC: Knowledge Object access is workspace-scoped, not member-scoped

**Negative:**
- Engineers cannot "take their findings with them" when they leave (intentional)
- Attribution (promoted_by) persists even if the member requests deletion — this is a compliance consideration for GDPR right-to-erasure scenarios (deferred to Enterprise tier)

**Constraint to preserve:**
Never model Knowledge Object ownership as personal. If a feature requires per-member knowledge ownership (e.g. a personal notes feature), it should be a separate entity type, not a modification to Knowledge Objects.
