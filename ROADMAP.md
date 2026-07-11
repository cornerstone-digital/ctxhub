# Roadmap

*Forward-looking milestones only. For what's already shipped, see [CHANGELOG.md](./CHANGELOG.md). For technical decisions, see the ADRs in [docs/adr/](./docs/adr/). For the full strategic milestone breakdown, see [docs/strategy/MILESTONES.md](./docs/strategy/MILESTONES.md).*

---

## Where we are

M1 (Runtime), M2 (Mission Control reliability), and M3 (Team) are complete. The indexing pipeline, MCP server, CLI, Captains, Missions, Execution Profiles, Personas, Mission Control, and persistent knowledge capture are all working and reliable.

The architecture for Cloud, the Org Graph, and the Identity model is designed and documented in `docs/` with 13 ADRs in `docs/adr/`. The current focus is M4: getting the first real users.

A Founding Design Partner pilot with VodafoneThree Engineering has moved Enterprise Foundations and Cloud into active development alongside M4. VodafoneThree operates multiple distinct engineering organisations — Vodafone UK, Three UK, and Voxi — and wants to share context and knowledge across them as part of the UK trial. This has fired two triggers earlier than expected: the M6 Cloud MVP trigger (multiple ctxhub instances needing coordination) and introduced a new requirement not previously in the roadmap — **Corporate Groups**, where multiple legally separate orgs within a corporate group share knowledge under controlled conditions. See the Enterprise Foundations and Corporate Group workstreams below.

The Enterprise Foundations core is built: Microsoft Entra ID SSO with PKCE, group-to-role mapping, single-tenant deployment via Docker Compose + Helm, JSONL audit log, workspace-level RBAC (`ctxhub workspace set-roles`), `ctxhub auth configure` with env var override, and `ctxhub doctor --enterprise` health checks. Security documentation and UK data residency statements remain.

The Corporate Groups foundation is complete: the data model (`CorporateGroup`, `Org`, `SharingPolicy`, `TrustTier`), the JSON store, the full CLI (`ctxhub group create/list/add-org/remove-org/sharing/status/invite/join`), all six server routes, MCP tools, audit events, the Groups panel in Mission Control, and cross-org user resolution via `tenantId` (Entra `tid` claim carried through login, stored in the ctxhub JWT, and surfaced in `Principal`). Cross-org search fan-out is stubbed and ready; actual HTTP fan-out to peer instances is the next step, gated on peer discovery from M6.

The M6 Cloud foundations are now in place: the Postgres schema design (`src/cloud/schema.sql`), the sync protocol stub (`src/cloud/sync.ts`, `ctxhub sync --to-cloud`), context pack sharing (`ctxhub share`), peer registry auto-registration via heartbeat (`POST /peers/heartbeat`, `GET /peers`, `ctxhub group heartbeat`, `ctxhub service set-peer-url`), and cloud configuration CLI (`ctxhub cloud configure` / `ctxhub cloud status`).

---

## Current hypothesis

We believe engineering teams want an operating model where AI work is observable, reviewable, and compounds into institutional knowledge. Milestones M4–M16 exist to validate or invalidate that hypothesis.

Every milestone after M4 is optional. Reality decides the roadmap.

---

## Health metrics

Real signal, not vanity.

| Metric | Why it matters |
|--------|----------------|
| Weekly active workspaces | Are people actually using it? |
| Captain promotions / week | Is knowledge compounding? |
| Mission Control opens / day | Is it part of the daily workflow? |
| Average install → first Captain run | Onboarding friction |
| Average install → first promotion | Does the value loop close? |
| Blueprint installs | Ecosystem health |

---

## Principles in practice

The four principles from [PRINCIPLES.md](./docs/strategy/PRINCIPLES.md) are each first realised in a specific milestone. The flywheel stages show where the scope of compounding expands.

**Principles** (from PRINCIPLES.md)

| Principle | First realised in |
|-----------|-------------------|
| Open Context | M1 — Runtime |
| Humans Stay in Control | M2 — Mission Control |
| The Loop (Observe → Understand → Recommend → Approve → Remember) | M2–M3 |
| Knowledge Compounds | M3 — Team |

**Engineering Flywheel — expanding radius**

| Stage | Milestone |
|-------|-----------|
| Individual knowledge | M1–M3 — Runtime, Mission Control, Team |
| Organisation knowledge | M7 — Org Graph |
| Institutional judgement | M10 — Engineering Intelligence |
| Industry knowledge | M13–M14 — Federation + Engineering Network |

---

## What we are not optimising for

- Replacing Git, IDEs, or AI models — ctxhub works alongside them, not instead of them
- Becoming an autonomous coding agent — humans approve; ctxhub observes, captures, and surfaces
- Becoming an observability or monitoring platform — we track knowledge, not system metrics
- Becoming a project management tool — Jira, Linear, and Asana exist; ctxhub feeds them, not replaces them
- Maximising feature count — scope is a cost; every milestone removes features before adding them

---

## Milestone 1 — Runtime *(done)*

**The promise:** "Install ctxhub. Every AI tool immediately understands my project better than it did yesterday."

### What's left

- [x] Indexing reliability audit — `recent()` memory fix, `status()` accurate for large repos, batched deletes, LLM summary timeout
- [x] MCP tool stability pass — 16 tools (12 default + 4 opt-in); `recordUsage` errors swallowed, all handlers wrapped, config-not-found and unknown-repo return actionable guidance
- [x] Eval suite — `ctxhub eval --health` for workspace-agnostic smoke test; `ctxhub eval --init` generates a 5-case starter suite; `--suggest-queries` expands it with LLM-suggested cases
- [x] Error messages — `ctxhub index` validates config before starting, LanceDB load failure explains recovery steps, 0-repo workspace tells user what to do
- [x] README rewrite — done

### Exit condition

A developer with two repos and two AI tools installs ctxhub, runs `ctxhub index`, and their agents immediately give better answers — without needing to read more than the README.

### What we learned

- Error quality is a product feature. LanceDB failures are the most common silent failure mode; the recovery message matters as much as the feature.
- Eval design was harder than indexing design. Getting workspace-agnostic tests that produce a meaningful signal took more iterations than expected.
- The 0-repo empty state is the most important empty state. First-run experience sets the tone for everything that follows.

---

## Milestone 2 — Mission Control *(done)*

**The promise:** "I enjoy opening Mission Control every morning."

### What's left

- [x] Captain overnight reliability — 3-minute outer timeout on explain calls, listCaptainRuns capped at 50 (most-recent), refetchInterval added to useCaptainRuns
- [x] Mission end-to-end reliability — same 3-minute per-step timeout in job runner, steps can no longer hang indefinitely
- [x] Dashboard performance — TaskRuns capped at 20 visible with "show N older" toggle, no unbounded DOM render
- [x] Empty states — ReviewView: no-workspace state with ctxhub init instructions; persona dropdown shows "No review personas configured" instead of permanent "Loading…"
- [x] Mission replay (basic) — click any Captain run row to expand full detail (answer, citations, llmNotice, flag + promote actions); most-recent-first with collapsible rows

### Exit condition

A developer opens Mission Control, sees what their Captain did overnight, promotes one finding, and closes it — in under two minutes, feeling good about it.

### What we learned

- Timeout guards are not optional. Without a 3-minute outer timeout, Captain runs hang indefinitely and silently — making Mission Control unreliable as a morning ritual.
- Empty states are as important as happy-path states. A permanent "Loading…" spinner is worse than no spinner at all.
- Mission replay requires a durable event log. In-memory event history doesn't survive service restarts; `events.jsonl` was the right answer.

---

## Milestone 3 — Team *(done)*

**The promise:** "Our engineering knowledge survives people leaving."

### What's left

- [x] Persistent Captain run history — server-side pagination (?limit&offset), "load more" UI, total count returned from API
- [x] Knowledge Capture Rate metric — captain.run.promoted event, captainStats.json counter, per-task % badge and aggregate header in CaptainsView
- [x] Execution profile and persona sync — personas and execution profiles sync via git (already); ctxhub captain export/import CLI for task definitions across machines
- [x] Structured promoted notes with searchable frontmatter — captainNoteTemplate adds captain-task, run-id, workspace, query fields to every promoted note
- [x] Mission replay — durable events.jsonl log (appended on every publish), GET /events/history API with limit/type filtering, Timeline view in Mission Control with date grouping, colour-coded dots, and type filters

### Exit condition

A new engineer on day one can read the last month of Captain findings and promoted ADRs in Mission Control and understand the codebase better than they would have in two months without it.

### What we learned

- Knowledge Capture Rate is the metric that matters — not "did the captain run?" but "did the team act on it?" Promotion rate is the only signal that knowledge is actually compounding.
- Structured frontmatter in promoted notes is essential for search. Unstructured notes are unsearchable at scale.
- The dual-graph model (Knowledge Graph + Topology Graph) emerged from trying to build a single graph and discovering it conflated two different concerns. The separation was the biggest architectural insight of the milestone.

---

## Milestone 4 — First Users *(current focus)*

**The promise:** "Someone who has never heard of ctxhub installs it, uses it, and wants to keep using it tomorrow."

### Infrastructure & Security *(completed)*

- [x] Security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Content-Security-Policy) — applied to every HTTP response
- [x] Rate limiting — in-memory per-IP, 10 req/min on /auth/* routes, 100 req/min on all other routes
- [x] Request size limits — 1MB cap enforced via Content-Length header check and streaming guard; returns 413
- [x] HMAC webhook signature verification — GitHub-style inbound `X-Hub-Signature-256` verification when `webhookSecret` is configured; `ctxhub webhook set-secret <secret>`
- [x] Mission Control SSE real-time updates — `EventSource('/events')` client in the dashboard; Live/Offline indicator; auto-refresh fallback on SSE error
- [x] Multi-workspace search — `ctxhub search --all-workspaces`; `GET /search?all-workspaces=true`; results annotated with workspace name, deduplicated by chunk id, sorted by score
- [x] Workspace export/import — `ctxhub workspace export --name <ws> --out <file.json>`; `ctxhub workspace import --from <file.json> [--name <override>]`; config, notes, and diagrams only (no index)

### What's left

- [ ] `npm install -g ctxhub` clean install verified on macOS arm64, macOS x64, and Ubuntu 22 (Node 22)
- [x] npm publish readiness — `.npmignore`, `files` field includes `dist/` and `CHANGELOG.md`, `keywords` added
- [x] `ctxhub version --check` — fetches latest from npm registry, prints update notice if behind; version check also added to `ctxhub doctor`
- [x] `ctxhub demo` scaffold command — creates demo workspace with 6 realistic docs, indexes, and promotes two chunks to institutional tier; idempotent with `--force` override
- [x] VF3 demo guide (`docs/vf3-demo-guide.md`) — internal 3-act demo script with setup steps, Q&A prep, and fallback scenarios for the VodafoneThree engineering meeting
- [x] `.ctxhubignore` security filtering — default patterns always applied (`.env`, `*.key`, `*.pem`, `secrets/`, etc.); file-based overrides; integrated into the indexer's fast-glob exclude list
- [x] GitHub Actions release workflow — tag-triggered (`v*.*.*`) build/test/publish pipeline; `install-matrix.yml` updated with `npx tsc --noEmit` types check after build
- [ ] Screenshots and 90-second demo video
- [ ] First external engineer installs ctxhub on a real project
- [ ] First piece of feedback collected and actioned

### Exit condition

One engineer outside the core team has been using ctxhub for at least one week, has promoted at least one Captain finding, and has not uninstalled it.

### We expect to learn

- Is installation actually simple, or does it silently fail in ways that never reach the issue tracker?
- Do engineers understand what a Captain is on first encounter, or does it require explanation?
- Do people trust promoted findings enough to act on them?
- Does Mission Control become a daily habit, or does it get opened twice and forgotten?

---

## Milestone 5 — Community *(no trigger — begins during M4)*

**The promise:** "I can contribute to ctxhub without talking to Martin."

A product that only grows through core team effort does not compound. This milestone runs in parallel with M4 and Enterprise Foundations — not sequentially.

**Community and Enterprise are parallel hypothesis tracks, not a sequence.**

Community validates the *product*: is ctxhub useful enough that people who didn't build it want to extend it? Enterprise validates *governance*: can ctxhub operate inside the trust, identity, and compliance model that large engineering organisations require? Both questions are equally important, and neither answer makes the other redundant. A product that only works for individuals but can't be governed is not enterprise-ready. A product that can be governed but nobody wants to extend is not a platform. Both tracks run simultaneously.

### What's left

- [ ] CONTRIBUTING.md — local setup in under 5 minutes; architecture orientation; how to find good first issues; review SLA (no PR sits unreviewed for more than 7 days)
- [ ] Good first issues — 10+ open issues labelled `good first issue` at all times; each has a clear definition of done and pointers to the relevant code
- [ ] Issue templates — bug report, feature request, blueprint proposal; each with enough structure that triage is fast
- [ ] First external PR merged — a code contribution from someone outside the core team reaches main
- [ ] First community blueprint — a blueprint contributed by a non-core team member, published to the registry
- [ ] First external Captain task — a Captain task definition contributed by a non-core engineer
- [ ] First documentation improvement — a non-core contributor improves documentation without being asked

### Exit condition

Five of the above items are completed without any direct involvement from the core team. The community is self-sustaining on the tasks it can reach; core team effort is reserved for decisions that require architectural context.

### We expect to learn

- What is the actual barrier to contribution — setup complexity, lack of good issues, unclear architecture, or slow review?
- Which parts of the codebase attract external contributors first?
- What do contributors want to build that we haven't thought of?

---

## Enterprise Foundations *(parallel workstream — trigger fired: VodafoneThree pilot)*

*This is not a sequential milestone. It runs alongside M4–M6 in response to real triggers firing earlier than anticipated. Full enterprise capability remains M9; this workstream delivers the subset needed to run a Founding Design Partner pilot.*

**What fired the trigger:** VodafoneThree Engineering has expressed interest in a Founding Design Partner arrangement spanning multiple engineering organisations within their UK group (Vodafone UK, Three UK, Voxi). Their requirements — SSO, single-tenant deployment, audit log, RBAC, and a credible compliance path — are enterprise foundations, not enterprise scale.

**Hypothesis:** Enterprise organisations are willing to pilot pre-certification software when the architecture provides structural privacy guarantees, the deployment model is single-tenant, and the commercial arrangement reflects the design partner relationship rather than a production contract.

### What's in Enterprise Foundations (building now)

- [x] **Microsoft Entra ID SSO** — OIDC-based with PKCE; JIT provisioning on first login; attribute mapping; group-to-role mapping; `ctxhub login` / `ctxhub logout`; covers the large majority of European enterprise customers including telcos
- [x] **Single-tenant deployment package** — Docker Compose + Helm chart (`helm/ctxhub/`); no dependency on ctxhub-managed infrastructure; data residency entirely within the customer's environment; see `docs/deploy/SELF_HOSTED.md`
- [x] **Audit log** — append-only JSONL; auth events: `auth.login`, `auth.logout`, `auth.token_refresh`, `auth.login_failed`, `auth.unauthorized`; group events: `group.created`, `group.org_added`, `group.org_removed`, `group.sharing_updated`
- [x] **5-role RBAC enforcement** — owner, admin, member, reader, machine; `ctxhub workspace set-roles` restricts HTTP API access per workspace; role resolution from Entra group claims at login
- [ ] Security and architecture trust documentation — written statement of the local-first data boundary, what is and isn't transmitted, and the structural basis for the "source code never leaves your machines" guarantee (see Security Architecture Brief)
- [ ] UK data residency statement — explicit documentation of where data rests in a single-tenant deployment
- [x] **Cross-org search trust gating** — `ChunkTrustTier` on indexed chunks; cross-org search already filters to `institutional+` so only explicitly elevated knowledge crosses the org boundary; captain-promoted findings automatically reach `institutional` tier on next index/sync
- [x] **`ctxhub auth configure`** — interactive configuration with env var override support (`CTXHUB_TENANT_ID`, `CTXHUB_CLIENT_ID`, `CTXHUB_CLIENT_SECRET`, `CTXHUB_JWT_SECRET`); `ctxhub auth role-map` sub-commands for managing Entra group → ctxhub role mappings
- [x] **`ctxhub doctor --enterprise`** — health checks for auth configured, session active, role map, groups store, and indexed knowledge
- [x] **Enterprise SSO step in `ctxhub onboard`** — guided onboarding includes Entra ID SSO configuration

### What is NOT in Enterprise Foundations (stays in M9)

- SAML 2.0, Generic OIDC (beyond Entra ID), SCIM provisioning
- Custom roles and per-workspace RBAC
- SOC2 Type II certification (credible roadmap is sufficient for the pilot)
- Multi-region, high-availability infrastructure
- Enterprise billing and procurement workflows

### Design partner

See `docs/strategy/DESIGN_PARTNER_CHARTER.md` for the Founding Design Partner arrangement with VodafoneThree Engineering.

### Review gate

When the pilot begins: **Proceed / Pause / Pivot** — based on whether the hypothesis above is validated. If VodafoneThree finds value and the design partner model produces genuine roadmap signal, proceed to full M9. If the pilot reveals that enterprise requirements differ fundamentally from what we designed for, M9 scope changes before implementation.

---

## Corporate Group *(parallel workstream — trigger fired: VodafoneThree UK trial requires cross-org knowledge sharing)*

*A new concept not in the original roadmap, surfaced by the VF3 UK trial. VodafoneThree operates multiple legally distinct engineering organisations — Vodafone UK, Three UK, Voxi — that want to share context and knowledge under a common group structure. This is not the same as Federation (M13), which is cross-company across independent organisations. A Corporate Group is controlled, internally trusted, and owned by a common parent entity.*

**The distinction that matters:**

| | Single Org (M6) | Corporate Group | Federation (M13) |
|---|---|---|---|
| Trust boundary | One organisation | Multiple orgs, shared parent | Independent companies |
| Knowledge sharing | Cross-workspace within org | Cross-org within group | Anonymised, cross-company |
| Identity | Shared org members | Group + org-level roles | External trust negotiation |
| VF3 example | One VF brand | VF UK + Three UK + Voxi | VF sharing with BT (never) |

**Hypothesis:** Large enterprises that operate multiple engineering organisations under a common parent need a controlled knowledge layer that spans those organisations — with explicit configuration, clear data boundaries per org, and group-level visibility for group leadership — without requiring those orgs to merge their identity or infrastructure.

### What's in Corporate Group (building for VF3 trial)

- [x] **Group entity** — `CorporateGroup` and `Org` types, JSON store (`groups.json`), CLI (`ctxhub group`), and 6 server routes (`POST/GET /groups`, `GET/DELETE /groups/:id`, `POST /groups/:id/orgs`, `DELETE /groups/:id/orgs/:orgId`, `PATCH /groups/:id/sharing`)
- [x] **Group-level RBAC** — admin/owner role required to create groups, add/remove orgs, and update sharing policies; enforced at the route layer via `hasRole(principal, 'admin')`
- [x] **Cross-org knowledge sharing data model** — `SharingPolicy` with `fromOrgId`, `toOrgId`, and `mode` (`none` | `read` | `bidirectional`); `TrustTier` per org (`observer` | `participant` | `trusted`); `canSearchCrossOrg` and `resolveOrgForUser` query helpers
- [x] **Cross-org search stub** — `POST /workspaces/:name/chat?cross-org=true` resolves the caller's org, identifies permitted peer orgs via sharing policies, logs the fan-out intent, and returns local results annotated with `sourceOrg` and `crossOrgEnabled: false`; actual HTTP fan-out to peer instances is the next step (see below)
- [x] **Group audit events** — `group.created`, `group.org_added`, `group.org_removed`, `group.sharing_updated` emitted to the event bus (fire-and-forget) from all mutating group operations
- [x] **Groups panel in Mission Control** — sidebar nav item; fetches `GET /groups`; renders each group with its orgs (name, tenantId, trust tier) and a sharing matrix (read / bidirectional / none per org pair)
- [x] **Chunk trust tier field** — `ChunkTrustTier` (`unverified` → `reviewed` → `promoted` → `institutional` → `canonical`) on every indexed chunk; `meetsMinTrustTier()` helper; cross-org search filters to `institutional+` automatically; indexer reads `trust-tier:` frontmatter to set tier at index time
- [x] **Captain approval → institutional tier** — `ctxhub captain promote` writes `trust-tier: institutional` into the promoted note's frontmatter; on next index/sync the chunk is automatically eligible for cross-org search without manual intervention
- [x] **`ctxhub chunk promote`** — manual tier elevation for workspace admins; supports `institutional` and `canonical` targets; records `promotedAt`, `promotedBy`, and optional `--reason`; `ctxhub chunk list --min-tier <tier>` shows all chunks at or above the specified tier
- [x] **MCP tools** — `group_list`, `group_create`, `group_add_org`, `group_sharing`, `group_status`, `chunk_promote`, `chunk_list_promoted`
- [x] **Workspace-level allowedRoles authorization** — `ctxhub workspace set-roles` restricts HTTP API access by role per workspace; enforced at the route layer
- [x] **`ctxhub group invite` / `ctxhub group join`** — group admin generates a short-lived signed invitation token (24h, HS256); org admin joins with `ctxhub group join <token>` using their current auth session tenantId
- [x] **`tenantId` on Principal** — Entra `tid` claim carried through login, stored in ctxhub JWT, surfaced in `Principal`; group membership shown in `ctxhub auth status`
- [ ] **Cross-org search fan-out (actual)** — HTTP calls from one ctxhub instance to permitted peer instances; requires M6 Cloud peer discovery or explicit peer URL configuration; stub is in place; peer `peerUrl` field already in the Org model
- [ ] **Group Mission Control** — aggregated view of captain runs and promoted findings across all member orgs; read-only; depends on Cloud sync (M6)
- [ ] **Group Org Graph** — cross-org knowledge queries within the group boundary; "what does the Three UK team know about our shared billing platform?" becomes answerable
- [ ] **Cross-org cascade rules** — a Captain finding in one member org can trigger a Captain run in another, where shared infrastructure or dependencies are declared
- [ ] **Group identity configuration** — a single Entra ID tenant can provision members into multiple orgs within the group with different roles per org

### What is NOT in Corporate Group

- Public or anonymous knowledge sharing (that is Federation, M13)
- Cross-group sharing between unrelated corporate groups
- Group-level billing or commercial consolidation (M9 Enterprise)
- AI-driven cross-org pattern detection (M10 Engineering Intelligence)

### Review gate

When the VF3 trial is underway: **Proceed / Pause / Pivot** — based on whether cross-org knowledge sharing produces value that couldn't be achieved by simply having each org run ctxhub independently. If the group layer produces genuine cross-pollination of engineering knowledge, this becomes a first-class feature of the Cloud tier. If orgs end up treating the group layer as administrative overhead rather than signal, the design changes.

---

## Milestone 6 — Cloud MVP *(trigger fired: VodafoneThree UK trial — multiple orgs, multiple instances)*

**The promise:** "My whole engineering org shares one Mission Control."

Architecture is fully designed — see `docs/cloud_architecture.md` and `docs/identity_model.md`.

**What fired the trigger:** The VodafoneThree Founding Design Partner trial requires ctxhub to coordinate across three distinct engineering organisations (Vodafone UK, Three UK, Voxi). This is the trigger condition: multiple ctxhub instances that need to share a common control plane. The Corporate Group workstream (above) extends M6 to support cross-org knowledge sharing within a corporate group boundary.

**Hypothesis:** Teams that coordinate multiple ctxhub instances want a shared Mission Control — not just better documentation or manual conventions.

### What's left

**Foundations in place (done):**
- [x] `ctxhub share` — one-time signed context pack sharing (`GET /share/:token`, `ctxhub share create/list/revoke`)
- [x] Peer registry — auto-registration via heartbeat (`POST /peers/heartbeat`, `GET /peers`), `Org.lastSeen` / `Org.registeredAt`
- [x] `ctxhub service set-peer-url` — configure the public URL of this instance
- [x] `ctxhub group heartbeat` — announce peerUrl to the local service; auto-heartbeat when service starts with peerUrl configured
- [x] M6 Cloud: Postgres schema design (`src/cloud/schema.sql`, `src/cloud/README.md`)
- [x] M6 Cloud: sync protocol stub (`src/cloud/sync.ts`, `ctxhub sync --to-cloud`)
- [x] M6 Cloud: `ctxhub cloud configure` / `ctxhub cloud status` — manage `~/.ctxhub/cloud.json`
- [x] CHANGELOG.md — Keep a Changelog format, all releases documented from v0.1.0 through v0.5.0
- [x] Mission Control Cloud panel — Cloud nav item, sync status card, Sync Now button calling `POST /cloud/sync`, recently synced chunks list
- [x] `POST /cloud/sync` server route — admin-required; loads promoted chunks; calls syncToCloud; returns `{ synced, errors }`
- [x] `GET /cloud/status` server route — returns configured, endpoint (masked), lastSyncAt, chunksSynced, chunksAvailable
- [x] MCP `cloud_sync` tool — triggers sync of institutional/canonical chunks from current workspace
- [x] MCP `cloud_status` tool — returns cloud configuration and last sync info
- [x] Enterprise quickstart in `docs/quickstart.md` — Entra ID registration, auth configure, role grant, corporate groups, cloud sync, self-hosted deploy
- [x] `ctxhub cloud sync` — standalone manual command; `--workspace` and `--dry-run` flags

**Still needed:**
- [ ] Organisation and member identity — `organisations`, `members`, `workspaces`, `machines` tables in Postgres (schema designed; service not deployed)
- [ ] Auth — JWT (1hr access / 30d refresh) + machine tokens (`ctxm_` prefix, bcrypt-hashed, 1yr expiry)
- [x] Cloud sync API — `POST /sync` endpoint on the Cloud service (stub client in place; `src/cloud/service.ts`)
- [ ] Cloud event ingestion API — `POST /sync/events`, `POST /sync/runs`, `POST /sync/notes`
- [ ] Cloud Mission Control — historical captain runs and promoted notes across all workspaces, read-only
- [ ] 5-role RBAC enforcement — owner, admin, member, reader, machine

### Exit condition

Two workspaces in one org sync independently. A member opens Cloud Mission Control and sees captain runs from both workspaces — filtered, sorted, searchable — without any manual coordination between machines.

### We expect to learn

- Do teams actually want shared Mission Control, or is per-engineer Mission Control sufficient?
- Is 5-minute sync cadence acceptable, or does async feel broken?
- Does historical-only Cloud Mission Control feel like a limitation, or is it fine?
- What do teams try to do with Cloud that we haven't built yet?

### Pre-flight checklist

Work through this before the VF3 trial begins:

- [ ] VF3 Entra ID app registration with production redirect URI
- [ ] `ctxhub auth configure` run on VF3 deployment with production credentials
- [ ] At least one repo indexed and searchable
- [ ] `ctxhub doctor` passes all checks
- [ ] Deployment verified via Docker Compose or Helm (see docs/deploy/SELF_HOSTED.md)
- [ ] One captain task defined and a test run approved
- [ ] Auth status shows correct user and role

### Review gate

M7 does not automatically begin. When this milestone completes: **Proceed / Pause / Pivot** — based on whether the hypothesis above is validated by observed behaviour. If teams use Cloud primarily as a backup rather than a coordination layer, the Org Graph may not be the right next step.

---

## Milestone 7 — Org Graph Phase 1 *(trigger: first org has 50+ promoted findings across workspaces)*

**The promise:** "Ask a question. Get every answer your org has ever captured — regardless of which repo or team it came from."

Architecture is fully designed — see `docs/org_graph_architecture.md`. Build starts when the trigger fires.

**Hypothesis:** Cross-workspace knowledge discovery is more valuable than per-workspace search once an org accumulates enough promoted findings to make search meaningful.

### What's left

- [ ] Knowledge Graph schema — `knowledge_objects`, `knowledge_edges`, `concepts`, `knowledge_object_concepts` in Postgres
- [ ] Topology Graph schema — `topology_repositories`, `topology_services`, `topology_edges`
- [ ] Cascade rules — `cascade_rules` table; auto-derived from topology `depends_on` edges (`basis="topology"`); manual rules persist when topology edge removed
- [ ] Knowledge Object lifecycle — draft → active → superseded → archived; `confidence`, `corroborations`, `review_flag` fields
- [ ] Cross-workspace query API — `GET /knowledge?q=&workspace=&state=` with Postgres adjacency list traversal
- [ ] Cloud Mission Control: Knowledge view — browse and search Knowledge Objects across workspaces, filter by state and confidence

### Exit condition

An org with 3+ workspaces queries "what do we know about X?" and gets findings from all workspaces, ranked by confidence, with provenance (workspace, captain task, run ID) shown for each.

### We expect to learn

- Is cross-workspace search the primary value, or do orgs mostly care about their own workspace?
- Does the confidence model (corroboration, contradiction, human review) produce scores people trust and act on?
- Do cascade rules (automatic cross-workspace captain triggers) deliver on their promise, or are they too aggressive?
- What query patterns emerge that we haven't anticipated?

### Review gate

M8 does not automatically begin. When this milestone completes: **Proceed / Pause / Pivot** — based on whether orgs are using cross-workspace knowledge discovery as a daily tool, or treating the Org Graph as infrastructure they rarely touch.

---

## Milestone 8 — Blueprint Hub *(trigger: organic sharing of personas and captain tasks without infrastructure for it)*

**The promise:** "Install one blueprint. Your agents immediately understand your stack, your conventions, and your review standards."

Scope is known; architecture doc not yet written. Build starts when the trigger fires.

**Hypothesis:** Engineering teams prefer installing curated context configurations over building them from scratch — the same way they prefer npm packages over writing utilities themselves.

### What's left

- [ ] Blueprint manifest format — YAML schema defining: name, version, description, included personas, captain tasks, mission templates, industry config, dependencies, and runtime version constraint (`requires.runtime: ">=x.y"`)
- [ ] Blueprint packager — `ctxhub blueprint pack` produces a versioned `.ctxblueprint` archive from a local directory
- [ ] Blueprint registry — hosted registry (public + org-private namespaces); content-addressed storage; semver versioning
- [ ] CLI install/publish — `ctxhub blueprint install <name>[@version]`, `ctxhub blueprint publish`, `ctxhub blueprint list`, `ctxhub blueprint update`
- [ ] Blueprint Hub web UI — browse public blueprints, search by stack/language/framework, one-click install instructions, version history
- [ ] Org-private blueprints — blueprints published under an org namespace, only visible to org members; requires Cloud (M6)
- [ ] Topology-aware blueprints — a blueprint can declare which service types it applies to; Org Graph (M7) maps it onto matching workspaces automatically
- [ ] Blueprint composition — a blueprint can declare dependencies on other blueprints; installer resolves the graph

### Exit condition

An engineer joins a new company, runs `ctxhub blueprint install acme-corp/standard`, and has the full set of captain tasks, personas, and mission templates their org uses — without reading internal documentation or copying config files from a colleague.

### We expect to learn

- What is the most common first blueprint — language-specific, framework-specific, or org-specific?
- Does the public registry produce genuine community-driven blueprints, or do most installs come from private org registries?
- Does blueprint composition create dependency resolution problems, or does the resolver handle it cleanly?
- Is topology-awareness used in practice, or do engineers prefer explicit installs?

### Review gate

M9 does not automatically begin. When this milestone completes: **Proceed / Pause / Pivot** — based on whether Blueprint Hub is generating organic publishing behaviour, or whether it functions only as a private org config store without the ecosystem dynamics that make it valuable.

---

## Milestone 9 — Enterprise *(trigger: a real deal that can't close without it)*

**The promise:** "ctxhub meets your security team's requirements without an exceptions process."

Identity model and auth design are fully specified — see `docs/identity_model.md`. Build starts when the trigger fires.

**Hypothesis:** The primary blocker to enterprise adoption is security and compliance requirements — not feature gaps. Meeting those requirements unlocks deals that are already commercially motivated.

### What's left

- [ ] Generic OIDC — configurable OIDC provider (Okta, Azure AD, Google Workspace); JIT provisioning on first login; attribute mapping (email → member, groups → roles)
- [ ] SAML 2.0 — SP-initiated and IdP-initiated flows; signed assertions; attribute mapping; metadata endpoint
- [ ] SCIM 2.0 provisioning — `POST/GET/PUT/PATCH/DELETE /scim/v2/Users`; `POST/GET /scim/v2/Groups`; group→role mapping; deprovisioning sets status=deactivated and revokes all tokens
- [ ] Per-workspace RBAC — workspace-scoped roles layered over org roles; permission evaluation checks org role then workspace override
- [ ] Custom role creation — named roles with configurable permission sets; role assignment UI; role inheritance
- [ ] Audit log — append-only, structured JSON, 7yr retention; query API (date range, actor, resource, action); export to SIEM (webhook or S3); owner + admin access only
- [ ] Air-gapped deployment — self-hosted Cloud option; Docker Compose + Helm chart; no outbound calls to ctxhub infrastructure; licence key validation via local file
- [ ] Compliance documentation — SOC 2 Type II readiness (evidence pack); ISO 27001 control mapping; HIPAA BAA template; PCI DSS applicability statement
- [ ] Enterprise billing — per-seat pricing; purchase order / invoice flow; usage reporting API

### Exit condition

A 500-person engineering org procures ctxhub through their standard vendor process: security review passes, procurement signs off, IT provisions users via SCIM from their IdP, and the compliance team has the documentation they need — without a single manual step from the ctxhub side.

### We expect to learn

- Which SSO provider is required first — Okta, Azure AD, or Google Workspace?
- Does air-gapped deployment unlock deals that hosted Cloud cannot, or is it a compliance checkbox?
- Which compliance framework is the actual deal blocker — SOC 2, ISO 27001, HIPAA, or PCI?

### Review gate

When this milestone completes: **Proceed / Pause / Pivot** — based on whether enterprise customers are using ctxhub as a strategic tool or as a compliance-approved utility they barely touch.

---

## Milestone 10 — Engineering Intelligence *(trigger: leaders opening Mission Control for trends, not individual reviews)*

**The promise:** "Understand how your engineering organisation actually makes decisions — not how fast it closes tickets."

Depends on M7 (Org Graph) being live and populated with real data. Scope is known; architecture doc not yet written. Build starts when the trigger fires.

**Hypothesis:** Engineering leaders can make better decisions when they can see how their organisation's knowledge base is evolving over time — not just what individual captains found last night.

### What's left

- [ ] Knowledge velocity — time-series view of Knowledge Object creation, promotion, supersession, and archival rates per workspace and org-wide; trend lines, not point-in-time snapshots
- [ ] Topic clustering — unsupervised clustering of Knowledge Objects by concept; surfaces recurring themes the org keeps re-discovering (signals an unresolved problem or a missing standard)
- [ ] Decision archaeology — natural language query over historical promoted notes and ADRs: "why did we decide X?", "when did we stop using Y?", "who made the call on Z?"
- [ ] Knowledge coverage map — which repos and services have captain coverage? Which have promoted findings? Which are dark? Visualised as a topology overlay
- [ ] Confidence trends — how is organisational confidence in a topic changing over time? Rising (consensus forming) or falling (contradictions accumulating)?
- [ ] Cross-workspace pattern detection — captain findings that recur across multiple workspaces surface as org-level signals, not individual findings
- [ ] Recommendation generation — observations become evidence-backed recommendations, surfaced through the Observe → Understand → Recommend → Approve → Remember loop; recommendations are never autonomous, always human-gated
- [ ] Intelligence dashboard — executive-facing view: org knowledge health, active topics, knowledge coverage, decision rate over time; no raw findings, only patterns
- [ ] Digest export — scheduled digest of intelligence summary for engineering leaders who won't open another tool

### Exit condition

An engineering leader opens the Intelligence dashboard and learns something true and non-obvious about how their organisation makes architectural decisions — something they could not have found by reading individual captain findings or asking their team.

### We expect to learn

- What question do leaders actually want answered — "what is happening?" or "what should we do about it?"
- Does recommendation generation produce recommendations people trust, or does it surface noise?
- Is the Intelligence layer used by the same people who use Mission Control daily, or does it reach a new audience?

### Review gate

When this milestone completes: **Proceed / Pause / Pivot** — based on whether Engineering Intelligence produces decisions that leaders act on, or whether it becomes a dashboard people visit and leave unchanged.

---

## Future Horizons

*Milestones M11–M16 are known destinations, not scheduled work. Architecture will be designed when the trigger fires. Until then, each milestone is defined only by its promise, trigger, hypothesis, expected learnings, and exit condition. No implementation detail until the trigger is observed.*

---

## Milestone 11 — Marketplace *(trigger: Blueprint Hub has hundreds of blueprints, active maintainers, and organisations requesting paid distribution)*

**The promise:** "The best engineering practices become reusable products."

This is not about selling blueprints. The value is expertise becoming portable — the same way npm made code reusable, Blueprint Hub makes engineering judgement reusable. The Marketplace is the economic layer that makes maintaining that expertise sustainable.

**Hypothesis:** People are willing to pay for curated engineering expertise rather than building everything themselves — especially when the expertise covers a stack, framework, or compliance domain they don't have in-house.

### We expect to learn

- Do people buy expertise from individuals, or only from organisations they recognise?
- Do companies publish internally before going public, or do most blueprints start as public?
- Is revenue sufficient to motivate high-quality blueprint maintenance, or does quality decay after the initial publish?
- What price point makes sense — per-install, per-seat, or per-org subscription?

### Exit condition

One third-party blueprint author earns meaningful recurring revenue from blueprints they published and maintain independently.

### Review gate

When this milestone completes: **Proceed / Pause / Pivot** — based on whether the Marketplace creates a genuine ecosystem or concentrates installs in a small number of high-quality blueprints that could be maintained without a marketplace model.

---

## Milestone 12 — Cloud Execution *(trigger: teams repeatedly asking whether Captains can run in CI)*

**The promise:** "Captains run wherever your engineering happens."

This milestone is architecturally significant. Running Captains in Cloud requires context to move — which conflicts with the local-first principle (ADR-002) and the source-code boundary (ADR-010). Any implementation must be explicitly opt-in, use a secure context transfer mechanism, and be described in a dedicated ADR before a line of code is written.

**Hypothesis:** Cloud execution increases Captain coverage without reducing trust — because teams understand what context moves, have opted in explicitly, and see the same findings they'd get locally.

### We expect to learn

- Do people actually trust remote execution, or does "my code left my machine" create adoption resistance regardless of architecture?
- What context has to move for a Captain run to be useful? Is it less than we fear, or more?
- Is latency acceptable for overnight scheduled runs? What about on-demand runs?
- What does Cloud execution cost at scale, and does that change the pricing model?

### Exit condition

One organisation runs nightly Captain tasks entirely in CI, with no local `ctxhub service` running, and considers the results trustworthy enough to act on.

### Review gate

When this milestone completes: **Proceed / Pause / Pivot** — based on whether Cloud execution expands the audience for ctxhub (teams without always-on machines) or simply duplicates what local execution already provides.

---

## Milestone 13 — Federation *(trigger: two organisations want to share knowledge without merging their organisations)*

**The promise:** "Engineering organisations learn from each other without giving away their IP."

Federation is the most strategically significant milestone on this roadmap. The early surface is coordination — sharing blueprints, surfacing topology patterns between partner orgs. The deeper opportunity is collective institutional knowledge: anonymised security findings, framework migration patterns, architectural decisions — accumulated across organisations the way Stack Overflow accumulated individual knowledge. This is not a feature addition; it is a fundamentally different product surface.

**Hypothesis:** Collective engineering knowledge is more valuable than isolated organisational knowledge — and the privacy problem is solvable through anonymisation and selective disclosure, not avoidance.

### We expect to learn

- What are organisations willing to share, and what must remain private regardless of anonymisation?
- Does anonymisation work in practice, or does enough context leak through that organisations can identify each other?
- What categories of knowledge become universally useful when aggregated — security findings, dependency patterns, migration paths?
- Does federated knowledge produce recommendations people act on, or does provenance uncertainty make it untrustworthy?

### Exit condition

A recommendation surfaced in Organisation A originated from evidence gathered anonymously across multiple organisations — and the engineer who acted on it had no reason to doubt it.

### Review gate

When this milestone completes: **Proceed / Pause / Pivot** — based on whether Federation creates genuine inter-organisational learning or becomes a blueprint-sharing mechanism that could have been built without the privacy complexity.

---

## Milestone 14 — Engineering Network *(trigger: Federation becomes routine across multiple org clusters)*

**The promise:** "Engineering knowledge compounds across the industry."

Think GitHub for engineering judgement. Not code. Not secrets. Institutional learning — how are fintechs solving PSD3 compliance? How did organisations migrate from React 17 to React 20? What architecture patterns are emerging for LLM integration? This knowledge exists today, scattered across blog posts, conference talks, and Slack conversations. The Engineering Network is where it accumulates, structured, searchable, and evidence-backed.

**Hypothesis:** There is more value in aggregated, anonymised engineering decisions across an industry than in any individual organisation's internal knowledge base — and that value increases non-linearly with the number of contributing organisations.

### We expect to learn

- Does industry-level knowledge attract a meaningfully different audience than org-level knowledge?
- What is the contribution model — opt-in per finding, opt-in per topic, or default-on with opt-out?
- How do you prevent low-quality or intentionally misleading contributions from degrading the network?
- Does citing external knowledge in local recommendations increase or decrease trust?

### Exit condition

Engineering Intelligence in a ctxhub org regularly cites external organisational knowledge alongside local evidence — and engineers treat the external citations as credible signal, not noise.

### Review gate

When this milestone completes: **Proceed / Pause / Pivot** — based on whether the Engineering Network produces genuine industry-level insights, or whether it becomes a large-scale blueprint repository without the emergent intelligence the hypothesis depends on.

---

## Milestone 15 — AI Workforce *(trigger: organisations running dozens of Captains and asking how to coordinate them)*

**The promise:** "Humans coordinate an AI workforce with confidence."

This is not autonomous software engineering. It is the opposite: Mission Control scaled to an organisation that runs hundreds of scheduled Captains, specialised review teams, budget constraints, approval chains, and organisational policies governing what AI is permitted to observe, recommend, and promote. Mission Control becomes mission control.

**Hypothesis:** As AI capability grows, the bottleneck shifts from what AI can do to how humans coordinate, review, and take responsibility for what AI produces. The organisation that solves coordination wins — not the one with the best model.

### We expect to learn

- At what scale does informal Captain coordination break down — 10 tasks, 50, 200?
- What organisational policies do engineering leaders want to enforce on AI behaviour, and can those policies be expressed in a structured way?
- Does budget-constrained AI coordination produce meaningfully different outcomes than unconstrained, or does scarcity drive better prioritisation?
- Who owns the AI workforce — individual engineers, team leads, a platform team?

### Exit condition

An organisation with 100+ active Captain tasks coordinates them through ctxhub policy and approval workflows, with no Captain running outside its defined scope and no finding promoted without appropriate human review.

---

## Milestone 16 — Operating System *(ten-year milestone)*

**The promise:** "Every engineering decision leaves the organisation smarter than before."

This is not a product milestone. It is the original mission, realised at full scale. The platform manages humans, AI, knowledge, policies, workflows, and judgement. It is not a tool that engineering organisations use — it is the model through which engineering organisations operate. Every decision made through ctxhub makes the next decision easier, cheaper, and more likely to be right.

**Hypothesis:** The sustainable competitive advantage in software engineering is not tooling speed, model capability, or headcount — it is accumulated institutional judgement. The organisation that systematically captures, validates, and compounds its engineering knowledge will outperform one that doesn't, over any sufficiently long time horizon.

### Exit condition

An engineering organisation that has been running ctxhub for five years makes better architectural decisions, with more confidence and less waste, than it did on day one — and can demonstrate the improvement through its own knowledge graph.

---

## Engineering Flywheel

Every milestone increases the scope over which the same asset — institutional engineering knowledge — creates value.

```
Developer
    ↓
Knowledge
    ↓
Team
    ↓
Organisation
    ↓
Industry
    ↓
Better Knowledge
```

Runtime (M1–M3) compounds individual knowledge. Mission Control (M4–M5) compounds team knowledge. Cloud and Org Graph (M6–M7) compound organisational knowledge. Federation and the Engineering Network (M13–M14) compound industry knowledge. Each layer makes the layer below it more valuable — a developer's promoted finding is more useful when it's visible to their team; a team's accumulated findings are more useful when they're visible across the organisation; an organisation's decisions are more useful when they're contributing to industry-level patterns.

The flywheel is the product. The milestones are how we build it.

---

## Commercial model

ctxhub monetises coordination, governance, and institutional memory — not AI, not models.

```
OSS Runtime          → free, always; the foundation
Cloud Coordination   → shared Mission Control, cross-workspace knowledge; subscription
Enterprise Governance → identity, RBAC, audit, compliance, Corporate Groups; enterprise licence
Industry Network     → Federation, anonymised cross-company signals; network tier
```

This is a deliberately different bet from most AI developer tools, which compete on model capability or generation speed. VodafoneThree's interest is not in faster code generation. It's in identity, governance, trust, knowledge ownership, and cross-organisation coordination — board-level engineering concerns, not developer conveniences. That's a different buying conversation, with different buyers, different budget lines, and a much longer retention curve.

The OSS runtime is not a loss leader. It is the product — the thing that makes the rest possible. Enterprise organisations adopt what developers trust. Developers trust what they've already used. The flywheel runs from individual → team → organisation → industry, and each layer of the commercial model corresponds to a layer of the flywheel.

---

## Success looks like

Five years from now, engineering teams don't think about "running ctxhub." They simply assume that every architectural decision their organisation has ever made is findable — that a new engineer on day one has access to a year of Captain findings, that promoted notes from last quarter are still visible and searchable, that knowledge doesn't leave when people do.

That's when the mission has succeeded: not when ctxhub is celebrated, but when the absence of it is unimaginable.

Like Git — not exciting. Load-bearing.
