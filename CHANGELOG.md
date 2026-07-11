# Changelog

All notable changes to ctxhub are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

_Changes on `main` not yet in a numbered release._

---

## [0.5.0] — 2026-07-11

### Added

**Enterprise Foundations**

- Microsoft Entra ID SSO — OIDC with PKCE flow; JIT user provisioning on first login; Entra group claims mapped to ctxhub roles at token issue time; `ctxhub login` / `ctxhub logout` CLI commands
- `ctxhub auth configure` — interactive Entra ID configuration with env var override support (`CTXHUB_TENANT_ID`, `CTXHUB_CLIENT_ID`, `CTXHUB_CLIENT_SECRET`, `CTXHUB_JWT_SECRET`)
- `ctxhub auth role-map` — sub-commands for managing Entra group → ctxhub role mappings (`add`, `remove`, `list`, `add-owner`)
- 5-role RBAC — `owner`, `admin`, `member`, `reader`, `machine`; enforced at the HTTP route layer per workspace
- Auth event audit log — append-only JSONL; events: `auth.login`, `auth.logout`, `auth.token_refresh`, `auth.login_failed`, `auth.unauthorized`
- Docker Compose and Helm chart (`helm/ctxhub/`) for single-tenant self-hosted deployment; see `docs/deploy/SELF_HOSTED.md`
- `docs/deploy/SELF_HOSTED.md` — complete self-hosted deployment guide with data residency notes
- Env var auth config — `CTXHUB_TENANT_ID`, `CTXHUB_CLIENT_ID`, `CTXHUB_CLIENT_SECRET` override the JSON config file at runtime
- `ctxhub doctor --enterprise` — health checks for auth configured, active session, role map, groups store, and indexed knowledge

**Corporate Groups**

- Corporate Groups data model — `CorporateGroup`, `Org`, `SharingPolicy`, `TrustTier` types; JSON store (`groups.json`)
- `ctxhub group create` — create a named corporate group
- `ctxhub group list` — list all groups with org counts
- `ctxhub group status` — detailed group health and sharing summary
- `ctxhub group add-org` — add an org to a group with optional trust tier
- `ctxhub group sharing` — update the sharing policy between two orgs
- Cross-org knowledge sharing with trust-tier gating — only chunks at `institutional` tier or above cross the org boundary; `canSearchCrossOrg` and `resolveOrgForUser` query helpers
- `ChunkTrustTier` field on indexed documents — values: `unverified` → `peer-reviewed` → `institutional` → `canonical`
- `ctxhub chunk promote` — elevate a chunk's trust tier (captain-approved chunks auto-reach `institutional`)
- `ctxhub chunk list` — list chunks at a given trust tier or above
- Group audit events — `group.created`, `group.org_added`, `group.org_removed`, `group.sharing_updated` emitted to the event bus
- Groups panel in Mission Control — live view of all groups, orgs, trust tiers, and sharing matrix
- MCP tools: `group_create`, `group_list`, `group_add_org`, `group_sharing`, `group_status`

**Cloud & Sync**

- Peer registry — `POST /peers/heartbeat`, `GET /peers`; auto-registration on service start; `ctxhub group heartbeat`, `ctxhub service set-peer-url`
- `ctxhub share` — signed one-time context pack sharing; produces a `.ctxpack` file with HMAC signature
- `ctxhub workspace export` — export workspace config, notes, and diagrams to a portable JSON archive
- `ctxhub workspace import` — import a workspace archive with optional name override
- `ctxhub sync --to-cloud` — push institutional/canonical chunks to ctxhub Cloud after local sync
- Cloud sync stub (`src/cloud/sync.ts`) — protocol types and wire format ready for the live cloud endpoint
- `ctxhub cloud configure` — save Cloud endpoint and API key to `~/.ctxhub/cloud.json`
- `ctxhub cloud status` — show cloud configuration and last sync statistics
- `ctxhub cloud sync` — manual command to push promoted chunks to Cloud; supports `--workspace` and `--dry-run`
- Cloud panel in Mission Control — shows sync status, endpoint, last sync time, chunk count, and a Sync Now button
- MCP tools: `cloud_sync`, `cloud_status`
- `POST /cloud/sync` server route (admin required) — triggers a cloud sync from the HTTP API

**Search & Multi-workspace**

- Multi-workspace search — `ctxhub search --all-workspaces`; `GET /search?all-workspaces=true`; results annotated with workspace name, deduplicated, sorted by score

**Security**

- Security headers — `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy` on every HTTP response
- Rate limiting — in-memory per-IP; 10 req/min on `/auth/*`, 100 req/min on all other routes
- Request size limits — 1 MB cap via `Content-Length` check and streaming guard; returns 413
- HMAC webhook signature verification — GitHub-style `X-Hub-Signature-256` on inbound webhook requests; `ctxhub webhook set-secret`

**Mission Control**

- SSE real-time updates — `EventSource('/events')` in the dashboard; Live/Offline indicator; 30-second polling fallback on SSE error

**Developer experience**

- `ctxhub version --check` — fetches the latest version from npm registry; prints an update notice if behind; also run by `ctxhub doctor`
- Enterprise quickstart in `docs/quickstart.md` — step-by-step guide for VF3-style Entra ID deployment

---

## [0.4.0] — 2026-04-15

### Added

- Mission replay — durable `events.jsonl` event log appended on every publish; `GET /events/history` API with `limit`/`type` filtering; Timeline view in Mission Control with date grouping, colour-coded dots, and type filters
- Persistent Captain run history — server-side pagination (`?limit&offset`); "Load more" UI; total count returned from API
- Knowledge Capture Rate metric — `captain.run.promoted` event; `captainStats.json` counter; per-task percentage badge and aggregate header in the Captains view
- Structured promoted notes with searchable frontmatter — `captainNoteTemplate` adds `captain-task`, `run-id`, `workspace`, `query` fields to every promoted note
- Execution profile and persona export/import CLI — `ctxhub captain export` / `ctxhub captain import` for task definitions across machines
- Jobs feature — multi-step pipeline runner; `ctxhub job run <file>`; steps execute sequentially with shared context
- Webhook triggers — `POST /webhooks/:name` dispatches a configured job; `ctxhub webhook add`

---

## [0.3.0] — 2026-02-20

### Added

- Mission Control dashboard — full-screen force-directed graph of workspace fleet; detail slide-in with per-workspace health checks; chat panel calling `POST /workspaces/:name/chat`
- Captain overnight reliability — 3-minute outer timeout on explain calls; `listCaptainRuns` capped at 50 (most-recent); `refetchInterval` added to `useCaptainRuns`
- Mission end-to-end reliability — same 3-minute per-step timeout in job runner; steps can no longer hang indefinitely
- Dashboard performance — TaskRuns capped at 20 visible with "show N older" toggle; no unbounded DOM render
- Empty states — ReviewView: no-workspace state with `ctxhub init` instructions; persona dropdown shows "No review personas configured" instead of permanent "Loading…"
- Eval UI — `ctxhub eval --health` for workspace-agnostic smoke test; `ctxhub eval --init` generates a 5-case starter suite; `--suggest-queries` expands it with LLM-suggested cases

---

## [0.2.0] — 2025-12-01

### Added

- MemPalace — durable local memory; diary-style notes and named drawers; `ctxhub memory add`, `ctxhub memory search`, `ctxhub memory timeline`
- Captain tasks — scheduled AI tasks that run against the workspace index; `ctxhub captain create`, `ctxhub captain run`
- Workspace service and registry — `~/.ctxhub/workspaces.json`; `ctxhub workspace register`, `ctxhub workspace list`, `ctxhub workspace remove`

---

## [0.1.0] — 2025-09-15

### Added

- Core indexing pipeline — LanceDB-backed vector + full-text search; `ctxhub index`, `ctxhub repo add`
- MCP server — 12 default read-only tools + 4 opt-in mutating tools; `ctxhub mcp`
- `ctxhub init` — scaffold `ctxhub.yaml` and `.mcp.json` in a project directory
- `ctxhub search` — keyword and semantic search with facet filtering
- `ctxhub pack` — generate a context pack for a directory or query
- `ctxhub explain` — LLM-powered explanation of a file or symbol
- `ctxhub ask` — ask a free-form question answered from the workspace index
- `ctxhub repo` — repo management sub-commands (`add`, `list`, `remove`, `status`)

---

[Unreleased]: https://github.com/ctxhub/ctxhub/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/ctxhub/ctxhub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ctxhub/ctxhub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ctxhub/ctxhub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ctxhub/ctxhub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ctxhub/ctxhub/releases/tag/v0.1.0
