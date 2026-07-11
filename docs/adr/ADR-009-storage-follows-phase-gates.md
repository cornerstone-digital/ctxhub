# ADR-009 — Storage strategy follows phase gates; no premature graph infrastructure

**Date:** July 2026  
**Status:** Accepted

## Context

The Organisation Graph will eventually need to support: adjacency traversal, semantic similarity search, and potentially deep multi-hop graph queries across large datasets. Neo4j, pgvector, and purpose-built graph databases are available and well-known. There is a temptation to introduce them early to avoid a future migration.

However, premature infrastructure complexity has a real cost: it increases the operational burden, makes local development harder (spinning up Neo4j alongside Postgres adds friction), and optimises for a scale problem that doesn't exist yet. PostgreSQL with appropriate indexes handles adjacency list queries at the scale ctxhub will reach in Phase 1 and 2 far better than most engineers expect.

## Decision

**Storage infrastructure is introduced only when a specific trigger condition makes the current approach demonstrably insufficient. Three phase gates are defined:**

**Phase 1 — PostgreSQL adjacency list (default)**
- `knowledge_objects`, `knowledge_edges`, `topology_edges` as standard relational tables
- Graph traversal via recursive CTEs (`WITH RECURSIVE`) — handles depth ≤ 5 hops cleanly
- Full-text search via `tsvector` columns on `knowledge_objects.body` and `title`
- Applies until: recursive CTE performance degrades under real production load, or Phase 2 trigger fires

**Phase 2 — pgvector (semantic similarity)**
- Trigger: more than 500 active Knowledge Objects AND users are requesting "find related findings" that keyword search cannot satisfy
- Add `embedding vector(1536)` column to `knowledge_objects` (additive, no migration)
- Embed `body` at promotion time using the configured LLM agent
- Enable auto-derived `related_to` edges (cosine similarity > 0.85)
- pgvector is a Postgres extension — no new database infrastructure

**Phase 3 — Purpose-built graph database**
- Trigger: recursive CTE queries at depth > 5 hops become the bottleneck under real load, AND graph traversal is a primary product surface (not a background feature)
- Postgres remains the source of truth; graph DB is a projection layer
- Evaluate Neo4j or Apache AGE at this point; do not pre-select

## Consequences

**Positive:**
- Local development stays simple — one Postgres instance covers all Phase 1 and 2 needs
- No graph database to operate, monitor, or back up until the scale genuinely demands it
- Phase gates are concrete and measurable, preventing premature optimisation based on speculation

**Negative:**
- A future migration to a graph database is more disruptive than if it had been included from the start
- Some queries that a graph database handles elegantly (variable-depth traversals, shortest path) require more careful Postgres query design

**Constraint to preserve:**
Do not introduce Neo4j, DGraph, or any purpose-built graph database before the Phase 3 trigger fires. If a query is slow, optimise the Postgres query or add an index first. The trigger must be real production load, not a benchmark.
