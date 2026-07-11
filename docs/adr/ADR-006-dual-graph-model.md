# ADR-006 — Dual-graph model: Knowledge Graph and Engineering Topology Graph are separate

**Date:** July 2026  
**Status:** Accepted

## Context

The Organisation Graph needs to represent two different kinds of facts about an engineering organisation:

1. **What the organisation knows** — promoted findings, concept relationships, confidence, lifecycle, provenance
2. **How the engineering system is structured** — workspaces, repositories, services, dependencies, ownership

An early design treated these as a single graph with mixed edge types: `superseded_by`, `related_to`, and `contradicts` (semantic) sat alongside `depends_on` and `cascade_to` (structural). This conflation creates problems: the two kinds of edges change at different rates, answer different questions, and have different query patterns. Structural topology changes when engineers add services or change dependencies. Semantic knowledge edges change when engineers promote findings or resolve contradictions.

More critically, automatic cascade rule derivation is only possible if topology is a first-class concept. If `depends_on` is just another edge in a mixed graph, you cannot cleanly say "derive cascade rules from topology changes" — you'd have to filter by edge type and re-derive on every change.

## Decision

**The Organisation Graph is two distinct graphs sharing Postgres storage, connected by an explicit intersection/join layer.**

**Knowledge Graph** answers: *"What do we know, and is it still true?"*
- Nodes: KnowledgeObject, Concept
- Edges: superseded_by, related_to, contradicts, about
- Schema: `knowledge_objects`, `knowledge_edges`, `concepts`, `knowledge_object_concepts`

**Engineering Topology Graph** answers: *"What exists, how does it connect, who owns it?"*
- Nodes: Workspace, Repository, Service
- Edges: contains, depends_on, owned_by, part_of, calls
- Schema: `topology_edges` (polymorphic from/to via `from_type`/`to_type`)

**Intersection layer** connects them without mixing schemas:
- `knowledge_objects.workspace_id` — a Knowledge Object's discovered-in Workspace (FK into topology)
- `cascade_rules` — a separate table derived from topology `depends_on` edges (see ADR-007)

## Consequences

**Positive:**
- Each graph's schema is coherent and purpose-specific
- Topology changes can trigger cascade rule derivation automatically (ADR-007)
- Graph traversal queries are unambiguous — you never accidentally traverse a structural edge when querying semantic relationships
- The two graphs can evolve independently: topology might gain a `deployment` node type without affecting the knowledge schema

**Negative:**
- Two schemas to maintain instead of one
- Cross-graph queries require an explicit join through the intersection layer
- Contributors must understand which graph they're working with

**Constraint to preserve:**
Do not add structural topology edges (depends_on, contains, owned_by) to the knowledge_edges table, and do not add semantic edges (superseded_by, related_to, contradicts) to topology_edges. If an edge spans both graphs, it belongs in the intersection layer as a named join table.
