# ADR-016 — Five-tier trust model for knowledge promotion

**Date:** July 2026  
**Status:** Accepted

## Context

ctxhub indexes everything it can read. Not all indexed content is equal: auto-indexed raw files, manually reviewed findings, and canonised reference material have very different reliability and sensitivity profiles. Cross-org knowledge sharing must be gated on content quality, not just access control. A binary "trusted/untrusted" model is too coarse; an arbitrary point scale is too hard to reason about.

## Decision

**Trust tiers are a five-level ordered set: `unverified` → `reviewed` → `promoted` → `institutional` → `canonical`.**

| Tier | Meaning | Path to elevation |
|---|---|---|
| `unverified` | Auto-indexed, no human review | Default |
| `reviewed` | A captain or human has read and accepted the chunk | Captain run or `ctxhub chunk promote --tier reviewed` |
| `promoted` | Explicitly promoted by a workspace captain | Captain `approve` or `ctxhub chunk promote` |
| `institutional` | Org-level endorsement; crosses org boundaries in cross-org search | Captain approval (owner role) |
| `canonical` | Locked reference material; highest confidence | Manual `ctxhub chunk promote --tier canonical --by <name>` |

Cross-org federation search (ADR-015) gates at `institutional`. Cloud sync (ADR-017) only sends `institutional` and `canonical` chunks.

## Consequences

**Positive:**
- Clear promotion path; each tier has a defined human or automated approval step.
- Cross-org boundary is unambiguous: institutional or above only.
- Canonical tier provides a stable anchor for reference material.

**Negative:**
- Captain approval is the primary path to `institutional`; manual `ctxhub chunk promote` is an escape hatch but easy to misuse.
- Five tiers require more documentation than two; onboarding takes longer.
