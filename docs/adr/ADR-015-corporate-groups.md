# ADR-015 — Corporate Groups as the multi-entity sharing model

**Date:** July 2026  
**Status:** Accepted

## Context

The VF3 merger scenario requires two distinct legal entities to share engineering knowledge while maintaining separation of concerns: teams within each entity can see each other's promoted knowledge, but administrative boundaries (billing, data residency, incident ownership) remain per-entity. A flat single-org model cannot represent this; a full federation protocol is disproportionately complex for the current scale.

## Decision

**The sharing model is: CorporateGroup > Org > SharingPolicy, stored as files in `~/.ctxhub/`.**

A `CorporateGroup` contains one or more `Org` records. Each org has a `SharingPolicy` that governs what trust tiers cross the org boundary when searching. Cross-org search is only permitted within the same group and only for chunks at `institutional` trust tier or above.

This hierarchy is managed via `ctxhub group` commands and stored in `~/.ctxhub/groups.json`. No central coordination server is required for the file-based model; peer discovery uses heartbeat URLs.

## Consequences

**Positive:**
- Represents real-world legal and operational entity boundaries without per-row ACLs.
- File-based storage keeps the architecture local-first (ADR-002).
- Simpler than a full federation protocol while covering the primary VF3 use case.

**Negative:**
- More complex than a single-org model; operators must understand the Group > Org > Policy hierarchy.
- Cross-org search fan-out adds latency proportional to the number of peers in the group.
- Manual peer URL registration is required until the Cloud service provides automatic discovery.
