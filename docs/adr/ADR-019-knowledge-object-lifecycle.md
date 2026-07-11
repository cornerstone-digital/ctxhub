# ADR-019 — Knowledge Object lifecycle

**Date:** July 2026  
**Status:** Accepted

## Context

Raw promoted chunks are point-in-time snapshots: a chunk is indexed from a file at a moment in time and elevated to `institutional` or `canonical` trust tier. But engineering knowledge is not static. Decisions get revisited, runbooks become stale, standards are superseded, and the context that made a chunk valuable shifts over time.

Without a structured lifecycle model, knowledge accumulates indefinitely without any mechanism to:
- Flag when a finding needs human review
- Record that a newer finding supersedes an older one
- Archive findings that are no longer relevant without destroying their audit trail
- Express confidence quantitatively so cross-org search can rank by certainty

The `ctxhub knowledge` commands were introduced to address this, but the underlying data model needed explicit articulation to guide consistent implementation and future extensions.

## Decision

**Knowledge Objects (KOs) are the versioned, lifecycle-managed form of promoted knowledge.**

The lifecycle states are:

```
draft → active → superseded → archived
```

- **draft**: A KO under construction. Not visible in cross-org search. Not yet considered authoritative.
- **active**: The authoritative version of a piece of knowledge. The source of truth for cross-org sharing. Returned by default in `GET /knowledge` queries.
- **superseded**: Replaced by a newer KO (`supersededBy` field points to the replacement). Retained for historical reference and audit trail. Not returned in default cross-org search results.
- **archived**: Explicitly retired. Not replaced by a specific newer KO — simply no longer relevant. Not returned in default cross-org search results.

Additional fields on every KO:

- **confidence** (0–1): Quantitative certainty. Set by the promoting user or agent. `0.5` is the default (uncertain). `0.9+` indicates high confidence supported by corroborating evidence.
- **corroborations**: Array of other KO IDs that support this finding. Corroboration increases confidence and provides an evidence chain.
- **reviewFlag**: Boolean. When `true`, the KO is surfaced to human reviewers. Set automatically when a finding contradicts an existing active KO, or manually via `ctxhub knowledge flag`.

State transitions:

- `draft → active`: explicit promotion via `ctxhub knowledge promote` or `POST /knowledge/:id/promote`
- `active → superseded`: when a newer KO supersedes it via `ctxhub knowledge supersede --by <new-id>`
- `active → archived`: explicit archival via `ctxhub knowledge archive`
- `superseded → archived`: allowed; represents a finding that was both replaced and explicitly retired

Transitions in the reverse direction (e.g. `active → draft`) are not permitted — they would break the audit trail.

## Consequences

**Positive:**

- Knowledge is queryable by state and confidence: cross-org search can return only `active` KOs above a confidence threshold, filtering out stale or tentative findings.
- Supersession creates an explicit chain of record: when a decision changes, the old KO is not deleted but marked superseded, with a pointer to the new one. Engineers can trace the history of a decision.
- Archived KOs are never deleted: the audit trail is complete. A KO can be archived but still inspected via `ctxhub knowledge show`.
- The `reviewFlag` surfaces human-review needs without blocking access: flagged KOs remain visible but are highlighted for attention, supporting the Observe → Understand → Recommend → Approve → Remember loop.

**Negative:**

- Lifecycle management adds operational overhead: in a high-volume Captain environment, KOs can accumulate in `draft` state if not promoted. Teams need to adopt a review cadence or automate promotion for high-confidence findings.
- Confidence scores are subjective unless backed by corroboration: a single agent assigning `confidence: 0.9` without corroborating evidence is not meaningfully different from `confidence: 0.5`. The model relies on teams using the corroboration mechanism for high-confidence claims.
- The `supersededBy` pointer creates a dependency: if the superseding KO is archived before the superseded one, the chain becomes inconsistent. The implementation must validate that `supersededBy` references an existing, non-archived KO at transition time.
- Per-workspace JSON store does not scale to thousands of KOs: the current implementation loads the entire store on every read. Migration to a queryable backend (Postgres, SQLite with FTS) will be required as KO volumes grow, likely at the M7 Org Graph milestone.
