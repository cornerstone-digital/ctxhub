# ctxhub Data Boundary Statement

**Version:** 1.0  
**Audience:** Enterprise security teams, IT procurement, compliance officers  
**Last updated:** 2025-07

This document describes exactly what data ctxhub stores, where it stores it, and under what conditions any data leaves a developer's machine. It is written for engineering organisations evaluating ctxhub for internal deployment — including VodafoneThree Engineering — and is intended to be specific enough to support a security review.

---

## 1. Local-first data boundary

By default, ctxhub stores all data on the developer's machine under `~/.ctxhub/`. This includes:

- `~/.ctxhub/index/` — indexed document chunks (LanceDB or LocalJSON)
- `~/.ctxhub/registry.json` — workspace registry (names and local paths)
- `~/.ctxhub/events.jsonl` — append-only audit event log
- `~/.ctxhub/captains/` — Captain task definitions and run history
- `~/.ctxhub/notes/` — promoted notes and knowledge captures
- `~/.ctxhub/auth.json` — auth configuration (tenant ID, client ID; never secrets in plaintext)
- `~/.ctxhub/cloud.json` — cloud sync configuration (endpoint and API key; opt-in only)
- `~/.ctxhub/blueprints/` — installed blueprints

No source code, no index content, and no knowledge chunks leave the machine unless explicitly configured. The default installation has no outbound network calls beyond those described in section 2.

---

## 2. What is transmitted, and when

The following is the complete list of data that can leave the machine. Everything here is either an explicit user action or a clearly scoped network call with no source code content.

### OIDC authentication flow (Microsoft Entra ID)

**When:** Only during `ctxhub login` or `ctxhub auth configure`.  
**What leaves the machine:** Client ID, PKCE code challenge, and the authorisation code returned by the IdP. The PKCE flow never sends a client secret over the network from the developer's machine.  
**What never leaves the machine:** Source code, workspace file contents, indexed chunks, or any knowledge content.  
**Destination:** Your organisation's Microsoft Entra ID tenant (your infrastructure, not Anthropic's or ctxhub's).

After login, ctxhub stores a short-lived JWT in `~/.ctxhub/auth.json`. The token is issued by your Entra ID tenant and verified locally. No auth tokens are sent to ctxhub infrastructure.

### Cloud sync (opt-in)

**When:** Only when explicitly configured via `ctxhub cloud configure` and triggered via `ctxhub sync --to-cloud`, `ctxhub cloud sync`, or the Mission Control "Sync Now" button.  
**What leaves the machine:** Only chunks that have been explicitly promoted to `institutional` or `canonical` trust tier. Unverified, reviewed, and promoted-tier chunks are never synced.  
**What never leaves the machine:** Raw source code, unindexed file contents, environment variables, secrets, or private keys.  
**Destination:** The cloud endpoint you configure — your infrastructure, not a shared ctxhub-operated backend. ctxhub does not operate a shared cloud service. The endpoint URL is set by your organisation.

The trust tier system is described in the chunk trust model (`ChunkTrustTier`: unverified → reviewed → promoted → institutional → canonical). Only institutional and canonical chunks are eligible for cross-org or cloud sync. Engineers explicitly promote chunks; this never happens automatically.

### Version check

**When:** `ctxhub version --check` or `ctxhub doctor` (the doctor check is read-only metadata).  
**What leaves the machine:** An HTTPS HEAD request to the npm registry for the `ctxhub` package metadata. No workspace data, no user identity, no source code.  
**Destination:** `registry.npmjs.org`.

### Peer heartbeat (opt-in)

**When:** Only when `ctxhub service set-peer-url` has been configured and the service is running.  
**What leaves the machine:** A JSON registration payload containing the configured peer URL, org ID, and group ID from environment variables. No source code or knowledge content.  
**Destination:** The peer ctxhub instances at the URLs you configure — your infrastructure.

### LLM agent calls (opt-in)

**When:** When running Captain tasks or Missions with an LLM agent configured.  
**What leaves the machine:** The query and retrieved context chunks that the LLM needs to answer the query. This is configurable — the amount of context is bounded by the `limit` setting in the Captain task definition.  
**Destination:** The LLM provider you configure (e.g. OpenAI, Anthropic, Azure OpenAI). ctxhub does not proxy LLM calls; it calls the provider directly using your API key.

---

## 3. What is never transmitted

The following categories of data are never transmitted by ctxhub, regardless of configuration:

- **Raw source code** — the indexer reads files to produce chunks, but raw file contents are never sent anywhere. Only chunked text is stored in `~/.ctxhub/index/`.
- **Workspace file contents** — files are read locally for indexing only; they are not buffered or forwarded.
- **Environment variables** — ctxhub reads named env vars for configuration (`CTXHUB_TENANT_ID`, `CTXHUB_CLIENT_ID`, etc.) but does not read or transmit `process.env` wholesale.
- **Secrets and private keys** — `.ctxhubignore` default patterns exclude `.env`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `secrets/`, `credentials/`, `.ssh/`, and similar patterns. These patterns are applied before indexing and cannot be bypassed without modifying the ignore file.
- **Git history** — ctxhub indexes file contents, not git history. `git log` output, commit messages, and diff history are not indexed.
- **Credentials in config files** — ctxhub reads `ctxhub.yaml` for workspace configuration but does not index or transmit the config file contents.

---

## 4. UK data residency

In a single-tenant deployment (Docker Compose or Helm), all data rests on your infrastructure. ctxhub does not operate a shared cloud backend. There is no ctxhub-operated service that stores your data.

The cloud sync endpoint is configurable to any URL you control:

```yaml
# ~/.ctxhub/cloud.json
{
  "endpoint": "https://ctxhub.your-org.internal",
  "apiKey": "..."
}
```

Data residency is entirely determined by where you deploy the cloud endpoint. To achieve UK data residency, deploy the cloud endpoint to a UK region on your infrastructure. ctxhub has no opinions about where you deploy it and makes no calls to infrastructure outside the URLs you configure.

The self-hosted deployment package is documented in `docs/deploy/SELF_HOSTED.md`. The Docker Compose and Helm configurations make no outbound calls to ctxhub-operated infrastructure.

---

## 5. Structural guarantees

The architecture makes source code exfiltration structurally impossible under a correctly configured deployment:

**The indexer reads but does not store raw files.** `src/indexing/indexer.ts` reads files via fast-glob, splits them into chunks, and writes only the chunked text to `~/.ctxhub/index/`. The raw file content is not persisted anywhere by ctxhub.

**The service binds to `127.0.0.1` by default.** `src/service/server.ts` binds to localhost unless explicitly configured otherwise. The service is not exposed to the network without administrator action.

**Rate limiting and auth middleware are enforced at the service layer.** Every HTTP endpoint is protected by rate limiting (10 req/min on `/auth/*`, 100 req/min on all other routes) and, where applicable, JWT authentication and RBAC. Unauthenticated requests are rejected before reaching any data handler.

**`.ctxhubignore` is applied before indexing.** The ignore list is evaluated by fast-glob before any file is read for indexing. A file that matches `.ctxhubignore` is never read, never chunked, and never stored. Default patterns cover common secret file types; teams can extend the ignore list but cannot reduce it below the defaults without modifying the source.

**Cloud sync is gated on explicit trust tier promotion.** A chunk can only be synced to a cloud endpoint if it has been explicitly promoted to `institutional` or `canonical` tier by a workspace admin or engineer. There is no configuration that causes unreviewed chunks to be synced.

---

## 6. Audit trail

Every auth event, knowledge promotion, context share, and sync operation is written to the local event log at `~/.ctxhub/events.jsonl`.

Events are append-only. Each event record includes:

- `type` — e.g. `auth.login`, `captain.run.promoted`, `chunk.promoted`, `cloud.sync`
- `sub` — the user's subject identifier from the Entra ID JWT
- `email` — the user's email address
- `timestamp` — ISO 8601 timestamp
- `detail` — event-specific payload (workspace name, chunk ID, tier, etc.)

The event log does not rotate or truncate automatically. It is stored locally and is accessible to the developer and to any enterprise audit tooling you configure to read it. The `GET /events/history` API endpoint exposes the log with date-range and type filtering for Mission Control's Timeline view.

For enterprise deployments, the event log can be shipped to a SIEM via the configured log forwarding infrastructure (ctxhub writes JSONL to disk; your infrastructure handles forwarding).

---

## Summary table

| Data category | Stored locally | Leaves machine | Condition |
|---|---|---|---|
| Source code (raw) | No | No | Never |
| Indexed chunks | Yes (`~/.ctxhub/index/`) | Only institutional/canonical | Explicit cloud sync (opt-in) |
| Auth tokens | Yes (`~/.ctxhub/auth.json`) | No | Verified locally |
| OIDC auth code | No (transient) | Yes | During login only |
| Workspace config | Yes (`ctxhub.yaml`) | No | Never |
| Event log | Yes (`events.jsonl`) | No | Never (your SIEM integration) |
| Captain findings | Yes (`~/.ctxhub/notes/`) | Only promoted chunks | Cloud sync (opt-in) |
| Environment variables | No | No | Never |
| Secrets / private keys | No | No | Excluded by .ctxhubignore |
| Version metadata | No (HEAD request) | Yes | `ctxhub version --check` only |

---

*For questions about this document, contact security@ctxhub.dev.*
