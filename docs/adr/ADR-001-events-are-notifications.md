# ADR-001 — Events are notifications, not source of truth

**Date:** July 2026  
**Status:** Accepted

## Context

ctxhub publishes events throughout the runtime: captain runs start and complete, indexing progresses, jobs execute steps, findings are promoted. There is an architectural choice at this point: events can be the authoritative record of what happened (event sourcing), or they can be notifications fired after state has already changed in a primary store.

Event sourcing offers benefits — full audit trail, replay, temporal queries — but adds significant complexity: every reader must replay the event stream to derive state, schema migrations require event versioning, and the system becomes harder to reason about for contributors unfamiliar with the pattern.

## Decision

**Events are notifications. State is authoritative. Events never become the source of truth.**

State lives in:
- JSON files on disk (`~/.ctxhub/`) — captain tasks, run records, stats, sync cursor
- LanceDB — the vector index
- PostgreSQL (Cloud) — org, member, workspace, captain run, Knowledge Object records

Events exist to:
- Update the Mission Control UI via SSE
- Notify integrations and webhooks
- Append to the durable `events.jsonl` log for the Timeline view
- Sync to Cloud (batch push)
- Trigger cascade captain runs

Events are derived from state changes, not the other way around. If an event is missed or lost, the state is unaffected.

## Consequences

**Positive:**
- The system is easy to reason about — current state is always readable directly from its store
- No event replay required to bootstrap a new consumer
- Schema changes to events are non-breaking (consumers can ignore unknown fields)
- The durable event log (`events.jsonl`) can be truncated or rotated without data loss

**Negative:**
- The event log is not a complete audit trail — it reflects what was published, not what was persisted
- Reconstructing history from events alone is not possible; history requires reading the primary stores
- If a state change happens without a corresponding event publish (e.g. direct file edit), the Timeline will miss it

**Constraint to preserve:**
Do not introduce a pattern where state is derived by replaying events. If a feature requires historical reconstruction, read the primary store or add an explicit history table — do not make events authoritative.
