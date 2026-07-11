# Architectural Decision Records

This directory contains the Architectural Decision Records (ADRs) for ctxhub. Each ADR documents a significant architectural decision: the context in which it was made, the decision itself, and its consequences.

ADRs are append-only. Once accepted, an ADR is not edited — if a decision changes, a new ADR is written that supersedes the old one. This preserves the reasoning at the time of the original decision.

## When to write an ADR

Write an ADR when:
- A decision is non-obvious (a reasonable engineer could make the opposite choice)
- A decision has significant consequences that future contributors should understand
- A constraint is being established that should prevent future drift

Do not write an ADR for implementation details, library choices below the architectural level, or decisions that are easily reversible.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-events-are-notifications.md) | Events are notifications, not source of truth | Accepted |
| [ADR-002](ADR-002-local-first-cloud-optional.md) | Local-first architecture; Cloud is optional | Accepted |
| [ADR-003](ADR-003-push-based-sync.md) | Push-based sync; Cloud never polls local machines | Accepted |
| [ADR-004](ADR-004-cloud-mission-control-is-historical.md) | Cloud Mission Control is historical, not live | Accepted |
| [ADR-005](ADR-005-knowledge-objects-owned-by-workspace.md) | Knowledge Objects are owned by Workspace, not by Member | Accepted |
| [ADR-006](ADR-006-dual-graph-model.md) | Dual-graph model: Knowledge Graph and Topology Graph are separate | Accepted |
| [ADR-007](ADR-007-cascade-rules-derived-from-topology.md) | Cascade rules are derived from topology edges, not manually configured | Accepted |
| [ADR-008](ADR-008-confidence-is-organisational.md) | Confidence scores are organisational, not model-generated | Accepted |
| [ADR-009](ADR-009-storage-follows-phase-gates.md) | Storage strategy follows phase gates; no premature graph infrastructure | Accepted |
| [ADR-010](ADR-010-source-code-never-leaves-the-machine.md) | Source code never leaves the local machine | Accepted |
| [ADR-011](ADR-011-llm-execution-always-local.md) | LLM execution runs locally in MVP; Cloud execution is a later explicit opt-in | Accepted |
| [ADR-012](ADR-012-rbac-minimalism.md) | RBAC minimalism: five roles, no custom roles in MVP or Team tier | Accepted |
| [ADR-013](ADR-013-build-only-when-trigger-fires.md) | Later phases are built only when their trigger condition fires | Accepted |

## Template

```markdown
# ADR-NNN — Title

**Date:** Month Year  
**Status:** Accepted | Superseded by ADR-NNN

## Context

Why was this decision necessary? What were the alternatives?

## Decision

What was decided, stated clearly and unambiguously.

## Consequences

What becomes easier, what becomes harder, and what constraint must be preserved.
```
