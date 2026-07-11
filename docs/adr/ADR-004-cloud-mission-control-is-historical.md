# ADR-004 — Cloud Mission Control is historical, not live

**Date:** July 2026  
**Status:** Accepted

## Context

Mission Control at localhost:7342 shows live captain run progress: animated tokens moving across the fleet graph, real-time SSE updates as runs start and complete. When Cloud Mission Control is built, there is a temptation to replicate this real-time experience — showing live progress from all machines in the organisation.

Doing so would require either: (a) persistent WebSocket connections from every local machine to Cloud, streaming run state in real time; or (b) Cloud polling each local machine's API. Both contradict ADR-002 (local-first) and ADR-003 (push-based sync). More importantly, real-time state management across hundreds of machines is a significantly harder engineering problem than aggregating completed records.

## Decision

**Cloud Mission Control shows completed runs, promoted findings, and aggregated history. It does not show live in-progress runs.**

- Live captain run progress (animated dots, step-by-step updates) remains exclusively at `localhost:7342`
- Cloud Mission Control polls the Cloud API every 30 seconds for completed records — it is a historical dashboard, not a live monitor
- A captain run appears in Cloud Mission Control only after it completes and the local machine's sync loop pushes it (within ~5 minutes)
- The Cloud timeline, capture rate, and promoted knowledge views are all historical aggregates

## Consequences

**Positive:**
- Cloud API is stateless with respect to live run state — no WebSocket infrastructure required
- No persistent connections from local machines to Cloud
- Significantly simpler Cloud architecture; the hard real-time problem is deferred indefinitely
- Cloud Mission Control's value proposition (team-wide historical view) is distinct from local Mission Control's (live machine view) — they complement rather than duplicate each other

**Negative:**
- A team member cannot watch a captain run in progress on another machine through Cloud Mission Control
- Cloud data is always 5–30 minutes stale (sync interval + poll interval)
- Users who expect a real-time experience from a "cloud dashboard" may be surprised

**Constraint to preserve:**
Do not add real-time streaming to Cloud Mission Control without a full architectural review. The moment Cloud becomes a real-time relay for local machine state, the complexity class of Cloud changes entirely.
