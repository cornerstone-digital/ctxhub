# ADR-012 — RBAC minimalism: five roles, no custom roles in MVP or Team tier

**Date:** July 2026  
**Status:** Accepted

## Context

Role-based access control systems commonly start simple and accumulate roles as feature requests arrive: a "reviewer" role here, a "security auditor" role there, "workspace admin" as distinct from "org admin." Over time the permission matrix becomes a maintenance burden, onboarding becomes confusing, and the system is hard to reason about.

The question is: what is the minimum set of roles that covers the real access control needs of engineering organisations using ctxhub, without creating complexity that only pays off at enterprise scale?

## Decision

**ctxhub Cloud has exactly five roles in MVP and Team tier. No custom role creation until Enterprise tier.**

| Role | Scope | Summary |
|------|-------|---------|
| `owner` | Org-wide | Full control: billing, member management, org deletion |
| `admin` | Org-wide | Manage workspaces, machines, tasks, blueprints, RBAC assignments (not billing) |
| `member` | Org-wide | Promote findings, create machine-level captain tasks, read all org data |
| `reader` | Org-wide | Read-only access. Cannot promote or modify. |
| `machine` | Machine | Service account for local runtimes. Sync only. Not assigned to humans. |

Deliberately excluded from MVP and Team tier:
- Per-workspace roles (workspace admin, workspace reader)
- Functional roles (reviewer, architect, security, maintainer)
- Custom role creation
- Role inheritance hierarchies

Custom roles and per-workspace RBAC are Enterprise tier features, added only when a deal requires them and the permission model has been validated by real Team tier usage.

## Consequences

**Positive:**
- The permission matrix is small enough to fit on one page and be understood in five minutes
- Onboarding is unambiguous: engineers are `member`, senior engineers may be `admin`, founders/leads are `owner`
- The five roles cover 95% of real team structures without any customisation
- Simpler implementation: no role inheritance, no permission unions, no role-scope intersections

**Negative:**
- An org with complex permission requirements (different teams have different access to different workspaces) cannot be modelled in MVP — they must wait for Enterprise RBAC or use org-level separation
- The `admin` role may feel too broad for some orgs that want to delegate workspace management without giving full admin rights

**Constraint to preserve:**
Do not add a sixth role to MVP or Team tier, even for a compelling use case. If a permission boundary is genuinely needed that the five roles cannot express, write an ADR proposing the addition and evaluate whether it belongs in Team or Enterprise tier. Roles are hard to remove once users depend on them.
