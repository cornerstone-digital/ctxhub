# ctxhub Organisation Graph
Architecture Design Document — v2
*Status: Draft  ·  July 2026*

## 1. What Is the Organisation Graph?
The Organisation Graph is a knowledge graph built from accumulated captain runs, promoted findings, and code relationships across an entire engineering organisation. It is the long-term moat of ctxhub — the asset that becomes more valuable with every promoted finding, every captain run, and every passing month.
An individual captain run produces a finding. The Organisation Graph connects thousands of findings into a navigable, queryable knowledge base that represents everything the organisation's AI agents have learned about the codebase.

### The compounding effect
After one week: a handful of promoted findings, useful but shallow.
After three months: cross-linked findings, patterns emerging across workspaces.
After one year: institutional memory that survives team turnover, rewrites, and reorganisations. A new engineer on day one can traverse the graph and understand decisions that took the team months to make.

### Why it's the moat
- Proprietary to the organisation — cannot be replicated by a competitor
- Compounds: each new promoted finding adds value to existing ones through connections
- Survives: unlike engineers' memories or Slack threads, the graph is structured and persistent
- Provenanced: every node knows which captain task generated it, which run, which workspace, which engineer promoted it
- Semantically queryable — not just by keyword, but by meaning

## 2. The Dual-Graph Model
The Organisation Graph is not one graph — it is two distinct graphs sharing the same storage, connected by a thin intersection layer. Keeping them conceptually separate, even in Phase 1 when both live in Postgres, prevents the schemas from conflating structural facts about the system with semantic facts about what the system does.

| **Graph** | **What it represents** | **Primary question answered** |
| --- | --- | --- |
| Knowledge Graph | Promoted findings, concepts, relationships, provenance. What the organisation's AI agents have learned. | "What do we know, and is it still true?" |
| Engineering Topology Graph | Workspaces, repositories, services, ownership, dependencies. How the engineering system is structured. | "What exists, how does it connect, and who owns it?" |

They intersect through a join layer: Knowledge Objects are discovered in Workspaces (knowledge → topology); Captain Tasks monitor Workspaces (task → topology); Cascade Rules derive from topology edges to propagate findings automatically.

### Why the separation matters
In v1 of this document, depends_on and cascade_to edges lived inside the knowledge graph schema alongside superseded_by and related_to edges. This was a mistake: topology edges are structural (A depends on B); knowledge edges are semantic (A supersedes B). They answer different questions and change at different rates. Topology changes when engineers add a new service or change a dependency. Knowledge edges change when engineers promote new findings or resolve contradictions.
More importantly: if cascade rules are derived from topology edges rather than manually configured, you get automatic propagation with zero configuration. Add a depends_on edge between two workspaces and cascade rules appear. Remove it and they disappear. That is only possible if topology is a first-class concept, not a tag on a knowledge edge.

## 3. Knowledge Graph
### Node types

| **Node type** | **Description** | **Created by** |
| --- | --- | --- |
| KnowledgeObject | A promoted finding with full provenance and lifecycle | Engineer promotes a captain run |
| Concept | An LLM-extracted topic tag (e.g. "auth", "rate-limiting", "concurrency") | Extracted at promotion time |

### Edge types

| **Edge** | **From → To** | **Description** |
| --- | --- | --- |
| superseded_by | KnowledgeObject → KnowledgeObject | A newer finding replaces this one. The older object transitions to superseded state. |
| related_to | KnowledgeObject → KnowledgeObject | Semantically related. Created manually or automatically (cosine similarity > 0.85 in Phase 2). |
| contradicts | KnowledgeObject → KnowledgeObject | These findings conflict. Requires human resolution before either can be fully trusted. |
| about | KnowledgeObject → Concept | This finding relates to this concept/topic. |

### Knowledge Object lifecycle

| **State** | **Meaning** | **Transition** |
| --- | --- | --- |
| draft | Captain run completed but not yet reviewed by an engineer | Engineer reviews → promoted (active) or discarded |
| active | Promoted and believed to be current | superseded_by newer finding, or manually archived |
| superseded | A newer Knowledge Object replaces this. Read-only, link to successor preserved. | Terminal (read-only) |
| archived | Deliberately marked stale (e.g. feature removed). Reason recorded. | Terminal (read-only) |

### Confidence score
Confidence starts at 1.0 on promotion. It increases when a second captain task independently produces a semantically similar finding (Phase 2: cosine similarity > 0.85), or when an engineer explicitly marks it as still accurate. It decreases — and triggers a review_flag — when referenced files change significantly, or when a later finding contradicts this one.

### Knowledge Object schema
```
knowledge_objects {
  id              uuid PK
  org_id          uuid FK organisations
  workspace_id    uuid FK workspaces      -- intersection with topology graph
  captain_task_id uuid FK team_captain_tasks (nullable)
  run_id          text                    -- local captain run ulid
  promoted_by     uuid FK members
  promoted_at     timestamptz

  title           text
  body            text                    -- full markdown
  query           text                    -- captain query that produced this
  agent           text                    -- LLM agent name

  state           text                    -- draft | active | superseded | archived
  superseded_by   uuid FK knowledge_objects (nullable)
  archived_at     timestamptz (nullable)
  archive_reason  text (nullable)
  expires_at      timestamptz (nullable)

  confidence      float                   -- 0.0 – 1.0
  corroborations  int                     -- independent confirmations
  review_flag     boolean

  embedding       vector(1536) (nullable) -- Phase 2: pgvector
}

knowledge_edges {
  id          uuid PK
  org_id      uuid FK organisations
  from_id     uuid FK knowledge_objects
  to_id       uuid FK knowledge_objects
  edge_type   text       -- superseded_by | related_to | contradicts
  confidence  float      -- for auto-derived edges (Phase 2)
  created_by  text       -- "human" | "auto"
  created_at  timestamptz
}

concepts {
  id          uuid PK
  org_id      uuid FK organisations
  name        text       -- "authentication", "rate-limiting"
}

knowledge_object_concepts {
  object_id   uuid FK knowledge_objects
  concept_id  uuid FK concepts
}
```

## 4. Engineering Topology Graph
### Node types

| **Node type** | **Description** | **Created by** |
| --- | --- | --- |
| Workspace | A registered ctxhub workspace. The primary unit of technical identity. | ctxhub cloud sync on first registration |
| Repository | A git repository within a workspace. Explicit node for dependency tracking. | Derived from workspace.repo_names on sync |
| Service | A deployable unit — may span multiple repositories. Optional; manually registered. | Admin registers via API or UI |
| Member | An engineer. Shared with the identity model; included in topology for ownership edges. | Member joins org |

### Edge types

| **Edge** | **From → To** | **Description** |
| --- | --- | --- |
| contains | Workspace → Repository | This workspace includes this repository. |
| depends_on | Workspace → Workspace | Source workspace imports from, calls, or otherwise depends on target. Basis for auto-cascade derivation. |
| owned_by | Workspace → Member | Team or individual ownership of a workspace. |
| part_of | Repository → Service | This repository contributes to this service boundary. |
| calls | Service → Service | Service A makes API calls to service B. Finer-grained than workspace depends_on. |

### Topology node schemas
```
topology_workspaces {
  -- mirrors workspaces table; topology view adds edges
  id              uuid PK  (= workspaces.id)
}

topology_repositories {
  id              uuid PK
  org_id          uuid FK organisations
  workspace_id    uuid FK workspaces
  name            text       -- "api", "web"
  git_remote      text (nullable)
}

topology_services {
  id              uuid PK
  org_id          uuid FK organisations
  name            text       -- "payments-service"
  description     text (nullable)
  created_by      uuid FK members
}

topology_edges {
  id              uuid PK
  org_id          uuid FK organisations
  from_type       text       -- workspace | repository | service | member
  from_id         uuid
  to_type         text
  to_id           uuid
  edge_type       text       -- contains | depends_on | owned_by | part_of | calls
  basis           text       -- "inferred" (from code analysis) | "manual"
  created_by      uuid FK members (nullable)
  created_at      timestamptz
}
```

## 5. Intersection Layer
The two graphs are connected by a small set of cross-graph relationships. These are stored as explicit join records — not mixed into either graph's edge table. This keeps each graph's schema clean and makes the intersection explicit.

| **Relationship** | **From graph** | **To graph** | **Description** |
| --- | --- | --- | --- |
| KnowledgeObject discovered_in Workspace | Knowledge | Topology | Which workspace produced this finding. Already on the KnowledgeObject schema as workspace_id. |
| CaptainTask monitors Workspace | Task (neutral) | Topology | Which workspaces a captain task is scoped to. Allows topology-aware task targeting. |
| CascadeRule (see below) | Topology | Task / Knowledge | Propagation rules derived from topology edges. Separate table. |

### Cascade Rules — derived from topology
This is the key improvement over v1. In v1, cascade_to was a manually configured edge in the knowledge graph. In v2, cascade rules are a separate table that can be derived automatically from topology depends_on edges, or configured manually as overrides.

```
cascade_rules {
  id                  uuid PK
  org_id              uuid FK organisations
  source_workspace_id uuid FK workspaces
  target_workspace_id uuid FK workspaces

  -- "topology": derived from a depends_on edge; deleted when that edge is removed.
  -- "manual": admin-configured; persists independently of topology.
  basis               text            -- "topology" | "manual"
  topology_edge_id    uuid FK topology_edges (nullable)

  -- What event in source workspace triggers a captain run in target workspace.
  trigger             text            -- "captain.run.promoted" | "confidence.degraded" | "contradiction.detected"

  -- Optional filter: only cascade if this specific captain task produced the trigger.
  filter_captain_task text (nullable)

  created_by          uuid FK members (nullable)
  created_at          timestamptz
}
```

### Auto-derivation of cascade rules
When a topology depends_on edge is created (Workspace A → Workspace B), the Cloud API automatically creates a cascade_rule with basis="topology" for the default trigger (captain.run.promoted). This means: if a finding is promoted in A, the relevant captain task is also run in B — without any manual configuration.
When the depends_on edge is deleted (e.g. the codebase no longer imports from that service), all cascade_rules with basis="topology" and topology_edge_id pointing to that edge are also deleted. Manual rules (basis="manual") are never auto-deleted.

### The combined query
The intersection makes the most powerful query possible: "if there's an auth vulnerability in service X, which dependent services should also be reviewed?"
```
1. Knowledge Graph:  find active KnowledgeObjects where concept = "auth" and workspace = service-X
2. Topology Graph:   find all workspaces where depends_on → service-X
3. Cascade Rules:    for each dependent workspace, check if a cascade_rule exists
4. Action:           enqueue captain runs in each dependent workspace
```
This is Engineering Intelligence — cross-graph traversal producing actionable recommendations.

## 6. Storage Strategy (Phased)

| **Phase** | **Mechanism** | **Covers** | **Trigger** |
| --- | --- | --- | --- |
| Phase 1 | PostgreSQL adjacency list for both graphs | Up to ~10k Knowledge Objects, ~50k edges, ~1k topology nodes. Graph traversal via recursive CTEs (depth ≤ 5). | Day one |
| Phase 2 | Add pgvector to Postgres | Semantic similarity for auto related_to edges; semantic search endpoint. No new DB — extension only. | >500 active Knowledge Objects, or semantic search requested |
| Phase 3 | Purpose-built graph DB (Neo4j or Apache AGE) | Traversal depth > 5 hops; graph traversal is primary product surface, not background feature. | Recursive CTE performance degrades under real load |

Postgres handles this stack far longer than people expect. A single table of 10 million edges with appropriate indexes (from_id, to_id, edge_type) runs recursive CTE queries in < 50ms at depth 5. Do not introduce graph infrastructure until Postgres is demonstrably the bottleneck.

## 7. API Design
### Knowledge Graph endpoints

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| GET | /orgs/:slug/graph/objects | List Knowledge Objects (paginated, filterable by state/workspace/concept/confidence) |
| GET | /orgs/:slug/graph/objects/:id | Single object with all edges and related nodes |
| GET | /orgs/:slug/graph/search?q= | Keyword + semantic (Phase 2) search over active objects |
| PATCH | /orgs/:slug/graph/objects/:id | Update lifecycle state (supersede, archive), add/remove manual edges |
| GET | /orgs/:slug/graph/contradictions | All active contradicts edges — requires human resolution |
| GET | /orgs/:slug/graph/stale | Objects with confidence < 0.5 or review_flag=true |
| GET | /orgs/:slug/graph/traverse?from=:id&depth=3 | BFS traversal from a knowledge node, N hops |

### Topology Graph endpoints

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| GET | /orgs/:slug/topology/workspaces | All workspace nodes with edge counts |
| GET | /orgs/:slug/topology/workspaces/:id | Single workspace with all topology edges |
| POST | /orgs/:slug/topology/edges | Create a topology edge (depends_on, owned_by, etc.) |
| DELETE | /orgs/:slug/topology/edges/:id | Remove a topology edge (auto-deletes derived cascade rules) |
| GET | /orgs/:slug/topology/services | List all services |
| POST | /orgs/:slug/topology/services | Register a service |

### Cascade Rule endpoints

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| GET | /orgs/:slug/cascade-rules | List all cascade rules (auto-derived and manual) |
| POST | /orgs/:slug/cascade-rules | Create a manual cascade rule |
| DELETE | /orgs/:slug/cascade-rules/:id | Delete a manual rule (auto rules deleted via topology edge delete) |

### Example queries the combined graph answers
- "What do we know about authentication across all services?" → /graph/search?q=authentication&concept=auth
- "Which findings might be stale after the recent API refactor?" → /graph/stale?workspace=api-service
- "What services depend on the payments workspace?" → /topology/workspaces/payments-id (depends_on edges)
- "If we found a security issue in payments, what else needs review?" → traverse topology depends_on from payments + check cascade rules
- "What did we know about this last year that we no longer believe?" → /graph/objects?state=superseded&superseded_after=2025-01-01

## 8. Mission Control — Graph View
### Layout
Force-directed graph with two distinct visual layers:
- Topology layer: Workspace cluster hulls at the periphery, with service nodes inside them. Topology edges shown as structural lines.
- Knowledge layer: Knowledge Object nodes inside or adjacent to their workspace cluster. Knowledge edges (superseded_by, related_to, contradicts) shown as annotated arcs.
- Node sizing: Knowledge Objects sized by confidence. Workspace hulls sized by Knowledge Object count.
- Colour coding: green = active, amber = review_flag or contradicts, grey = superseded/archived.

### Toggle modes
- "Knowledge only" — hide topology hull boundaries; show only Knowledge Object nodes and knowledge edges.
- "Topology only" — show workspace and service nodes with depends_on edges; hide Knowledge Object detail.
- "Combined" — full view: topology as structure, knowledge as overlay.

### Interactions
- Click Knowledge Object → detail panel: title, body, provenance, confidence, all knowledge edges, link to source workspace
- Click Workspace node → side panel: all Knowledge Objects in this workspace, depends_on edges, cascade rules
- "Trace cascade" action → highlights the topology path a cascade rule would follow
- "Contradictions" view → filtered to only show contradicts edges, with resolution actions

## 9. Cross-Workspace Cascade
Cascade awareness is the mechanism by which a discovery in one workspace triggers action in another — now derived automatically from the topology graph rather than requiring manual configuration.

### Automatic derivation
An admin creates a topology depends_on edge: workspace "web-frontend" depends on workspace "api-service". The Cloud API immediately creates a cascade_rule (basis="topology") that means: when a finding is promoted in api-service, also run the same captain task in web-frontend.
No further configuration required. The cascade is implicit in the topology.

### Manual override
Manual cascade rules allow fine-grained control: cascade only for a specific captain task, or use a different trigger (confidence.degraded instead of captain.run.promoted). Manual rules persist independently of topology changes.

### Safety constraints
- Cascade chains are limited to depth 3: A triggers B triggers C, but C cannot trigger D. Prevents cascade storms.
- Each workspace may cascade at most once per hour from any single trigger.
- Cascade triggers are advisory: the local runtime runs the task if not already in flight.
- All cascade activity is logged in the Cloud event log with full provenance (trigger source, cascade_rule_id, basis).

## 10. Privacy Considerations
The Organisation Graph inherits the data boundary from the Cloud architecture: findings and metadata go to Cloud; source code never does.

### What the graph never contains
- Source code content — not in node bodies or edge metadata
- File content — citations reference paths (src/auth/session.ts) but not content
- Local file system paths — topology nodes use repo names and service names, not local paths

### What the graph does contain
- Technical findings about code architecture, patterns, decisions — opt-in via promotion
- Repo names and service names — reveal system structure, not content
- Engineer attribution for promoted findings — scoped to org members

### Isolation
- All nodes and edges partitioned by org_id — no cross-org traversal at the API layer
- Reader role can traverse the graph but cannot modify lifecycle state or edges
- Enterprise: single-tenant DB ensures physical graph isolation

## 11. Implementation Phases

| **Phase** | **Trigger** | **Deliverable** |
| --- | --- | --- |
| Phase 1 — Knowledge graph foundation | Cloud MVP live; first org with 50+ promoted findings | knowledge_objects + knowledge_edges + concepts tables; manual supersedes/related_to; knowledge-only graph view; keyword search |
| Phase 2 — Topology graph | Team asks "if I change this service, what else is affected?" | topology_nodes + topology_edges tables; depends_on edges; workspace cluster view; auto cascade_rule derivation from depends_on |
| Phase 3 — Semantic layer | Orgs asking "find related findings" and keyword search insufficient | pgvector embeddings on KnowledgeObjects; auto related_to edges; semantic search API; combined graph view |
| Phase 4 — Cross-workspace cascade | Teams asking "can findings in one service automatically trigger review in dependents?" | cascade_rules table; auto-derivation from topology; cascade trace UI; Engineering Intelligence preview |
| Phase 5 — Graph DB migration | Recursive CTE performance degrades; graph traversal is primary product surface | Evaluate Neo4j / Apache AGE; migrate graph layer while Postgres remains source of truth |

### Relationship to Engineering Intelligence
Engineering Intelligence (LATER_PHASES.md) is observation about how an organisation makes decisions over time. The dual-graph model is the substrate that makes it possible: the topology graph provides spatial context (which service, what depends on it, who owns it); the knowledge graph provides semantic context (what do we know, how confident are we, what was superseded). Intelligence is a read-only analytics view over both graphs — not a separate data store.

*ctxhub Organisation Graph · v2 · Draft · July 2026*
