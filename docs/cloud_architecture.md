# ctxhub Cloud
Architecture Design Document
*Status: Draft  ·  July 2026*

## 1. Model Overview
ctxhub Cloud follows the same model as NX Cloud: the local runtime remains the source of truth and does all the real work; Cloud is a coordination and visibility layer on top of it.
The analogy holds precisely:

| **Local tool** | **Cloud layer** | **Analogy** |
| --- | --- | --- |
| git | GitHub | Industry reference |
| Nx CLI | NX Cloud | Build coordination |
| ctxhub runtime | ctxhub Cloud | AI knowledge coordination |

### What Cloud does NOT do
- Run LLM calls — agents always run locally because they need codebase access
- Store source code or raw file content
- Replace the local service — localhost:7342 stays alive for live, real-time use

### What Cloud does
- Aggregates captain run results, promoted notes, and events from every machine in the org
- Provides a shared Mission Control URL the whole team can open
- Distributes team-level captain task definitions to all registered machines
- Tracks capture rate and run history across the entire organisation
- Provides the foundation for later phases: cloud-side orchestration, org graph, enterprise RBAC

## 2. Architecture
### Component diagram
```
                                                           
  ┌─────────────── Engineer A (machine) ────────────────┐ 
  │                                                      │ 
  │   ctxhub service (localhost:7342)                   │ 
  │   ┌────────────────────────────────────────────┐    │ 
  │   │  Indexer · Captain runner · Job runner     │    │ 
  │   │  MCP server · Event bus · events.jsonl     │    │ 
  │   └────────────────┬───────────────────────────┘    │ 
  │                    │ sync loop (every 5 min)         │ 
  │   Mission Control  │ pushes events, runs,            │ 
  │   localhost:7342   │ promotions                      │ 
  └───────────────────┼──────────────────────────────────┘ 
                      │                                    
  ┌───────────────────┼──────────────────────────────────┐ 
  │                   ▼                                  │ 
  │         ctxhub Cloud API                            │ 
  │         api.ctxhub.com                              │ 
  │                                                      │ 
  │   PostgreSQL  ·  R2 object storage  ·  Redis        │ 
  │                                                      │ 
  │         Cloud Mission Control                       │ 
  │         app.ctxhub.com                              │ 
  └──────────────────────────────────────────────────────┘ 
                      ▲                                    
  ┌───────────────────┼──────────────────────────────────┐ 
  │                   │ sync loop                        │ 
  │   ctxhub service (localhost:7342)                   │ 
  │   Engineer B (machine)                              │ 
  └──────────────────────────────────────────────────────┘ 
```

### Key design decisions
Local first, Cloud optional
ctxhub works fully offline. If Cloud is unreachable the local service continues running. Sync resumes from a cursor when connectivity is restored. Cloud config is absent by default — opt-in per workspace.
Push model
Local instances push to Cloud; Cloud never polls local machines. This avoids firewall issues, dynamic IPs, and NAT traversal. The pattern is identical to git push — the local runtime decides when to sync.
Cloud Mission Control is historical, not live
Real-time captain run progress (the animated dots in Mission Control) stays at localhost:7342. Cloud Mission Control shows completed runs, promotions, and the aggregated team timeline. This keeps the Cloud API stateless with respect to live job state.

## 3. Data Boundary
The boundary between what leaves the machine and what stays local is the most sensitive architectural decision. The rule: findings and metadata go to Cloud; source code and raw index data never do.

| **Data** | **Stays local** | **Goes to Cloud** | **Notes** |
| --- | --- | --- | --- |
| LanceDB index (embeddings) | ✓ |  | Too large, contains code chunks |
| Raw source code | ✓ |  | Never leaves the machine |
| ctxhub.yaml config | ✓ | partial | Cloud stanza pushed; rest stays |
| Captain run results |  | ✓ | Answer text + citation paths, no source |
| Promoted note content |  | opt-in | User explicitly accepted promotion |
| Event metadata |  | ✓ | Type, timestamp, workspace — no content |
| Captain stats |  | ✓ | Run counts, promoted counts |
| Team captain task definitions |  | ✓ | Pulled to local on sync |
| Workspace metadata |  | ✓ | Name, repo names (not local paths) |

Citation paths in captain run results reference file paths (e.g. src/auth/session.ts) but not file content. Cloud never has enough context to reconstruct source code from these paths.

## 4. Sync Protocol
### Approach: cursor-based background sync
The local ctxhub service runs a sync loop every 5 minutes when cloud config is present. It tracks a cursor — the ISO timestamp of the last successfully synced event — stored in ~/.ctxhub/cloud-sync.json.
On each tick, the loop:
- Reads events.jsonl from the cursor position forward
- Reads any captain runs completed since the last sync
- Reads any promotions since the last sync
- POSTs a batch payload to the Cloud API
- On success, advances the cursor
- On failure, retries with exponential backoff (max 3 attempts, then skips until next tick)

### Sync state file
```
// ~/.ctxhub/cloud-sync.json
{
  "eventsCursor": "2026-07-10T14:23:01.000Z",
  "lastSyncAt":   "2026-07-10T14:28:03.412Z",
  "lastSyncOk":   true
}
```

### Batch payload
```
POST /sync/batch
{
  "machineId": "mch_abc123",
  "workspaceId": "ws_def456",
  "events":    [...],   // CtxhubEventEnvelope[]
  "runs":      [...],   // completed CaptainRunRecords
  "promotions":[...],   // { runId, notePath, content? }
}
```

### Team task pull
After a successful push, the sync loop also GETs team captain task definitions. Any tasks not present locally are written; existing tasks are only overwritten if the cloud version has a newer updatedAt. Local-only tasks are not deleted — they are machine-specific overrides.
### Commands
```
ctxhub cloud login            # GitHub OAuth, stores machine token
ctxhub cloud logout           # revokes machine token
ctxhub cloud status           # shows cursor, last sync time, pending count
ctxhub cloud push             # manual one-off push (like git push)
ctxhub cloud pull             # pull team tasks now
```

## 5. Data Model (Cloud DB)
### Core tables
```
organizations
  id          uuid PK
  slug        text UNIQUE          -- "mycompany"
  name        text
  created_at  timestamptz

members
  id          uuid PK
  org_id      uuid FK organizations
  github_id   bigint UNIQUE
  email       text
  role        text                 -- owner | admin | member

machines
  id          uuid PK
  org_id      uuid FK organizations
  member_id   uuid FK members
  name        text                 -- "martin-mbp"
  token_hash  text                 -- bcrypt of machine token
  last_seen   timestamptz

workspaces
  id          uuid PK
  org_id      uuid FK organizations
  local_uuid  uuid UNIQUE          -- from ctxhub init, immutable
  name        text
  repo_names  text[]               -- ["api", "web"] — no local paths
  registered_by uuid FK members

captain_runs
  id          uuid PK
  org_id      uuid FK organizations
  workspace_id uuid FK workspaces
  machine_id  uuid FK machines
  task_name   text
  run_id      text                 -- local run ID (ulid)
  started_at  timestamptz
  result      jsonb                -- { answer, citations, llmNotice }

promoted_notes
  id          uuid PK
  org_id      uuid FK organizations
  workspace_id uuid FK workspaces
  run_id      uuid FK captain_runs
  note_path   text
  content     text                 -- null if content sync opted out
  promoted_at timestamptz
  promoted_by uuid FK members

events
  id          uuid PK
  org_id      uuid FK organizations
  workspace_id uuid FK workspaces
  machine_id  uuid FK machines
  type        text
  at          timestamptz
  payload     jsonb

team_captain_tasks
  id          uuid PK
  org_id      uuid FK organizations
  name        text
  query       text
  schedule    jsonb                -- { everyMinutes }
  persona     text
  profile     text
  updated_at  timestamptz
  created_by  uuid FK members
```

### Local config additions
```
# ctxhub.yaml — new cloud stanza
cloud:
  org: mycompany
  # machine token stored separately in ~/.ctxhub/cloud.json
  # content-sync: true   # opt-in: send promoted note content to Cloud
```

## 6. API Design
### Authentication
Two token types:
- Machine token — Bearer token issued at ctxhub cloud login, used for all sync calls. Scoped to a single machine.
- User JWT — issued after GitHub OAuth, used by Cloud Mission Control browser sessions. Scoped to a member.

### Sync endpoints (machine token)

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| POST | /sync/batch | Push events, captain runs, promotions in one call |
| GET | /sync/team-tasks | Pull team captain task definitions |
| POST | /machines/register | Register a new machine, receive machine token |
| DELETE | /machines/me | Revoke current machine token |

### Read endpoints (user JWT — Cloud Mission Control)

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| GET | /orgs/:slug/timeline | Aggregated events, all machines, paginated |
| GET | /orgs/:slug/captains/runs | All captain runs, filterable by task/workspace |
| GET | /orgs/:slug/captains/stats | Aggregate capture rate per task |
| GET | /orgs/:slug/knowledge | Promoted notes, searchable |
| GET | /orgs/:slug/workspaces | All registered workspaces |
| GET | /orgs/:slug/members | Members list |

### Management endpoints (user JWT)

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| POST | /orgs | Create org (owner-only) |
| POST | /orgs/:slug/members/invite | Invite a member by email |
| POST | /orgs/:slug/team-tasks | Create a team captain task |
| PATCH | /orgs/:slug/team-tasks/:id | Update a team captain task |
| DELETE | /orgs/:slug/team-tasks/:id | Remove a team captain task |

## 7. Local Runtime Changes
The local ctxhub runtime needs relatively few changes to support Cloud. Everything is additive — no existing behaviour changes.
### New: cloud sync loop
Added to ctxhub service startup (only if cloud config is present in ctxhub.yaml). Runs every 5 minutes, reads events.jsonl from cursor, batches and POSTs to Cloud API. Entirely best-effort — failures are logged but do not affect the local service.
### New: workspace UUID
ctxhub init generates a stable UUID stored in ctxhub.yaml as workspace.id. This UUID becomes the workspace's cloud identity. Existing workspaces receive a UUID on first ctxhub cloud login.
### New: cloud CLI commands
```
ctxhub cloud login     # opens browser → GitHub OAuth → stores machine token
ctxhub cloud logout    # revokes machine token
ctxhub cloud status    # last sync time, cursor position, pending count
ctxhub cloud push      # manual sync (blocks until complete)
ctxhub cloud pull      # pull team tasks immediately
```

### Modified: ctxhub.yaml schema
New optional cloud stanza. Absence means local-only mode — no behaviour change.
### Modified: promoteCaptainRun
After writing the local note, if cloud is configured and content-sync is enabled, also queues the note content for the next sync batch.

## 8. Cloud Mission Control
Cloud Mission Control is the same React + TypeScript SPA as the local Mission Control, redeployed at app.ctxhub.com against the Cloud API instead of localhost:7342.
### Differences from local Mission Control

| **Feature** | **Local (localhost:7342)** | **Cloud (app.ctxhub.com)** |
| --- | --- | --- |
| Auth | None (local trust) | GitHub OAuth + JWT |
| Scope | Single machine | Entire org, all machines |
| Real-time | SSE from local service | Polling only (30s) — no live runs |
| Timeline | This machine's events | All machines' events, date-grouped |
| Captains | This machine's tasks | All tasks, all machines, aggregate stats |
| Knowledge | Local promoted notes | All promotions across org (if content sync on) |
| Team Tasks | Not applicable | Create/edit/delete team captain tasks |

### URL structure
```
app.ctxhub.com/login                    -- GitHub OAuth entry point
app.ctxhub.com/:orgSlug                 -- org dashboard (fleet view)
app.ctxhub.com/:orgSlug/timeline        -- aggregated event timeline
app.ctxhub.com/:orgSlug/captains        -- all captain tasks and runs
app.ctxhub.com/:orgSlug/knowledge       -- promoted notes
app.ctxhub.com/:orgSlug/settings        -- org settings, members, team tasks
```

## 9. Tech Stack

| **Layer** | **Choice** | **Rationale** |
| --- | --- | --- |
| API language | Node.js + TypeScript | Same as ctxhub — one language for the whole system, shared types possible |
| API framework | Hono | Lightweight, fast, edge-ready, TypeScript-first |
| Database | PostgreSQL | Structured relational data, excellent JSONB support for payloads |
| Object storage | Cloudflare R2 | Cheap egress, S3-compatible, good for note content blobs |
| Cache / session | Redis (Upstash) | JWT blocklist, rate limiting, sync dedup |
| Auth | GitHub OAuth | Engineers already have accounts; repos are there; natural fit |
| Deploy (MVP) | Railway | Managed Postgres included, fast to ship, no Kubernetes overhead |
| Deploy (scale) | AWS / GCP | When Railway limits are hit or enterprise tenancy is needed |
| CDN | Cloudflare | Cloud Mission Control SPA, API caching headers |

## 10. MVP Scope
The smallest useful Cloud — enough to validate the model before building enterprise features.
### In MVP
- GitHub OAuth + org creation
- Machine token login (ctxhub cloud login)
- Background sync: events + captain run results + promotions
- Cloud Mission Control: org timeline, captains aggregate view, promoted knowledge
- Team captain task definitions — create in Cloud, pulled to local on sync
- Basic member management: invite by email, owner / member roles

### Not in MVP
- Real-time live run progress in Cloud Mission Control (stays at localhost)
- RBAC beyond owner / member
- Self-hosting option
- SSO / SCIM (enterprise)
- Cloud-side captain run execution
- Cross-workspace org graph queries
- Audit logs
- SLA / uptime guarantees

## 11. Trade-off Analysis
### Push model vs. webhook model
Local pushes on a timer (chosen). Alternative: Cloud webhooks local when it needs data. Webhooks require local to be reachable from the internet — impractical for dev machines behind NAT. Push wins.
### Batch sync vs. event-driven sync
Batch every 5 minutes (chosen for MVP). Alternative: hook into eventBus.publish() and stream events to Cloud in real time. Real-time sync adds latency to the hot path and needs a retry queue for when Cloud is offline. Batch is simpler and good enough for a team dashboard that is refreshed every 30 seconds anyway.
### Note content: opt-in vs. default on
Opt-in (chosen). Storing promoted note content enables full-text search and rich display in the org Knowledge view. But code-adjacent findings leaving the machine may be a concern for security-sensitive orgs. Default off with a clear opt-in flag (content-sync: true in ctxhub.yaml) respects that boundary.
### Multi-tenant vs. single-tenant DB
Multi-tenant (shared Postgres with org_id everywhere) is cheaper and simpler to operate — chosen for MVP. Single-tenant (dedicated DB per org) is needed for enterprise data isolation and compliance. Add as a paid Enterprise tier when the first deal requires it.
### GitHub OAuth vs. email/password
GitHub OAuth (chosen). The target user is a software engineer who already has a GitHub account and almost certainly has their repos on GitHub. Email/password adds a password reset flow, credential storage, and brute-force protection for marginal benefit. GitHub OAuth is simpler and more trustworthy.

## 12. Later Phases (post-MVP)
These are not commitments — each requires a trigger condition (observable user behaviour) before building starts.
### Phase 2 — Cloud-side captain execution
Trigger: teams asking to run captains on CI or in environments where a local ctxhub service is impractical. Cloud orchestrates a captain run by pulling a context pack from the local workspace and running the LLM call server-side. Requires Cloud to have API key management and sandboxed execution.
### Phase 3 — Organisation graph
Trigger: teams asking "which captain findings are related across our repos?". Cross-workspace queries over promoted notes and captain run results. Promoted findings become nodes; semantic similarity and captain-task overlap become edges.
### Phase 4 — Enterprise tier
Trigger: a real deal that cannot close without it. Single-tenant deployment, SSO (SAML/OIDC), SCIM provisioning, RBAC with custom roles, audit logs, air-gapped option, SOC 2 / ISO 27001 documentation.
### Phase 5 — Blueprint Hub
Trigger: organic sharing of personas and captain task packs without infrastructure for it. A marketplace for installable expertise: persona packs, captain task collections, execution profiles. Install a "Security Review" captain pack and it shows up in every engineer's Mission Control.

*ctxhub Cloud Architecture · Draft · July 2026*

## 12. Failure Modes
Documenting failure modes before implementation forces idempotency and recovery to be first-class concerns rather than afterthoughts. Every failure below has a defined local behaviour, Cloud behaviour, and recovery path.

| **Failure** | **Local behaviour** | **Cloud behaviour** | **Recovery** |
| --- | --- | --- | --- |
| **Cloud unreachable** | **Continues normally. Sync loop logs warning and skips tick.** | **N/A** | **Auto-retry with exponential backoff. On reconnect, replay from cursor — no data loss.** |
| **Machine token expired / revoked** | **Sync returns 401. Local service logs warning and pauses sync. All local features continue.** | **Token invalidated.** | **User runs ctxhub cloud login. Sync resumes from last cursor.** |
| **Duplicate batch push (network hiccup or retry)** | **Cursor not advanced until Cloud acknowledges.** | **Upserts on (workspace_id, event.id) and (workspace_id, run_id). No double-counting.** | **Idempotent by design. No action required.** |
| **Clock skew between machines** | **Events timestamped with local clock at publish time.** | **Stores received_at alongside at. Queries use received_at for ordering.** | **Transparent. event.id (ulid) is monotonically increasing per machine regardless of clock.** |
| **Workspace renamed locally** | **local_uuid unchanged — it is the stable identity.** | **Updates workspace.name on next successful sync.** | **Transparent. No data migration needed.** |
| **30-day offline replay** | **events.jsonl accumulates a large backlog.** | **Accepts chunked batches.** | **Sync loop sends 1,000 events per batch, advancing cursor per chunk. Drains over multiple ticks.** |
| **Crash during sync** | **Cursor not advanced — write is not acknowledged before crash.** | **N/A** | **On restart, replays from last cursor. Idempotency handles any duplicates.** |
| **Malformed JSONL line** | **Skipped silently (try/catch per line in readEventLog).** | **N/A** | **Single event may be missing from Cloud timeline. No crash. Acceptable data loss.** |
| **Same workspace on two machines (desktop + laptop)** | **Both register as separate machine_ids and push independently.** | **Events attributed per machine_id. Aggregate view shows both.** | **Expected and correct. Events are additive, not duplicated.** |
| **Machine removed from org (admin action)** | **Next sync returns 401.** | **Token revoked server-side.** | **Same as token revocation. User re-invites the machine via ctxhub cloud login.** |

### Idempotency contract
All Cloud sync endpoints must be idempotent. The local runtime may push the same events more than once — this is by design, not a bug. The idempotency keys are:
- Events: (org_id, workspace_id, event.id) — ulid is globally unique per event
- Captain runs: (org_id, workspace_id, run_id) — local ulid
- Promotions: (org_id, workspace_id, run_id, note_path)

Cloud uses upserts (INSERT ... ON CONFLICT DO NOTHING) on all sync endpoints. A 200 response means "received and stored or already exists" — never "stored for the first time."

### Backoff strategy
```
Sync failure backoff schedule:
  Attempt 1: retry after 30 seconds
  Attempt 2: retry after 2 minutes
  Attempt 3: retry after 5 minutes
  After 3 failures: skip until next scheduled tick (5 minutes)
  After 10 consecutive failed ticks: log prominent warning in ctxhub cloud status
```

### What is never retried
Token revocation (401) is treated as a hard stop, not a transient failure. The sync loop will not retry a 401 with backoff — it stops immediately and requires explicit user action (ctxhub cloud login) to resume. This prevents a revoked machine from hammering the auth service.

### Observability
ctxhub cloud status exposes sync health locally:
```
$ ctxhub cloud status

Org:          mycompany
Machine:      martin-mbp
Last sync:    2026-07-10 14:28:03 (3 minutes ago)
Status:       OK
Cursor:       2026-07-10T14:23:01.000Z
Pending:      0 events, 0 runs

$ ctxhub cloud status  # after a failure

Status:       SYNC_FAILED (attempt 2/3, retry in 2m)
Last error:   HTTP 503: Service Unavailable
```
