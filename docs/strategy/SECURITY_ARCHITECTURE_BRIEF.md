# ctxhub Security Architecture Brief

**Prepared for:** VodafoneThree Engineering — Cyber Security Review
**Version:** 1.0 — July 2026
**Prepared by:** ctxhub

---

## Purpose

This brief is written for VodafoneThree's cyber security team. It explains how ctxhub handles code, data, and identity — what leaves your environment, what stays, and why. It is intended to support your security review and answer the questions a cyber team typically asks before approving a developer tooling deployment.

---

## The core guarantee

**Source code and indexed content never leave VodafoneThree infrastructure.**

This is a structural guarantee, not a policy claim. It holds because of how the system is architected, not because of a contractual commitment or a settings flag that could be toggled.

The sections below explain how.

---

## Deployment model

ctxhub is deployed as a **single-tenant installation** within VodafoneThree's own infrastructure. There is no shared multi-tenant cloud environment. No ctxhub-managed infrastructure holds VodafoneThree data.

```
VodafoneThree infrastructure boundary
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   Developer machine           ctxhub server (self-hosted) │
│   ┌──────────────────┐        ┌────────────────────────┐  │
│   │ ctxhub CLI       │──────▶ │ ctxhub runtime         │  │
│   │ Source code      │        │ LanceDB (local index)  │  │
│   │ Local index      │        │ Mission Control UI      │  │
│   └──────────────────┘        │ Captain scheduler       │  │
│                               └────────────────────────┘  │
│                                          │                 │
│                               Cloud sync (metadata only)   │
│                                          │                 │
└──────────────────────────────────────────┼─────────────────┘
                                           │
                               ctxhub Cloud (coordination)
                               ┌───────────────────────────┐
                               │ Event log (no code)       │
                               │ Captain run metadata      │
                               │ Identity / RBAC           │
                               │ Mission Control API       │
                               └───────────────────────────┘
```

---

## What stays inside VodafoneThree infrastructure

| Data type | Where it lives | Transmitted? |
|---|---|---|
| Source code | Developer machines | Never |
| Indexed codebase content | LanceDB on developer machine / self-hosted server | Never |
| Captain task findings (raw) | Local ctxhub runtime | Never |
| Promoted knowledge notes | Local workspace | Never |
| `.env` files and secrets | Excluded from index by default | Never indexed |
| Embeddings / vector representations | LanceDB, local | Never |

---

## What the Cloud coordination layer receives

The Cloud layer exists for one purpose: allowing multiple ctxhub instances within a corporate group to share a common control plane (Mission Control, cross-org knowledge queries). It receives only metadata — never code content.

| Data type | Transmitted to Cloud | Notes |
|---|---|---|
| Captain run events | Yes — event type, timestamp, workspace ID, run status | No code, no findings content |
| Promoted note metadata | Yes — title, timestamp, tags, author identity | The note body is stored locally; metadata enables search across orgs |
| Workspace health metrics | Yes — index size (count), last sync time, eval scores | Aggregate counts, no content |
| Identity / auth tokens | Yes — JWT issued on login, scoped to workspace | Signed, short-lived (1hr access / 30d refresh) |
| Source code | No | Never |
| Indexed content | No | Never |
| Raw findings | No | Never |
| `.env` content | No | Never indexed, never transmitted |

The sync mechanism is **push-only from VodafoneThree machines** to ctxhub Cloud. ctxhub infrastructure never initiates a connection to VodafoneThree machines. There is no polling, no remote execution, and no inbound network access required.

---

## Identity and access

**Protocol:** OpenID Connect (OIDC) — the same protocol used by Microsoft's own first-party applications.

**Provider:** Microsoft Entra ID (formerly Azure Active Directory). VodafoneThree's existing Entra ID tenant is the identity provider. ctxhub is the relying party (service provider).

**How login works:**
1. User navigates to the ctxhub Mission Control or initiates `ctxhub login`
2. ctxhub redirects to VodafoneThree's Entra ID login page (hosted by Microsoft)
3. User authenticates with their VodafoneThree credentials — ctxhub never sees the password
4. Entra ID issues an ID token and access token to ctxhub
5. ctxhub maps Entra ID groups to ctxhub roles (owner / admin / member / reader / machine)
6. Session is established with short-lived JWT (1hr); refresh token valid for 30 days

**No VodafoneThree credentials are stored by ctxhub.** Authentication is entirely delegated to Entra ID.

**Entra ID application registration:**
- Registered in VodafoneThree's tenant (not ctxhub's)
- Scopes requested: `openid`, `profile`, `email`, `offline_access`
- No write access to Entra ID directory
- Redirect URIs are controlled by VodafoneThree

**RBAC model:**

| Role | Capabilities |
|---|---|
| owner | Full access; manage members; billing |
| admin | Manage workspaces, members, RBAC |
| member | Run captains, promote findings, index |
| reader | View Mission Control; no write access |
| machine | Machine token for CI/CD integration; scoped to index and sync |

For Corporate Group deployments (multi-org): group-owner and group-admin roles sit above org-level roles. A group-admin can view across member orgs but cannot override an org's internal access controls.

---

## Secrets and sensitive content

**`.env` files:** Excluded from the index by default. The default ignore pattern rejects `.env`, `.env.*`, and any file matched by `.gitignore`. No `.env` content is ever indexed.

**Secret patterns:** The indexer applies a redaction pass before writing chunks. Patterns matched and redacted: API keys (common prefixes), bearer tokens, private key blocks (PEM), connection strings with embedded credentials, AWS/GCP/Azure credential patterns.

**Configuration:** The `.ctxhubignore` file (same syntax as `.gitignore`) allows VodafoneThree to add additional exclusion patterns. This file is evaluated before any content is indexed.

---

## Data residency

**For the VodafoneThree UK pilot:**

- The self-hosted ctxhub runtime runs on VodafoneThree infrastructure in the UK. Code, indexed content, and findings remain within VodafoneThree infrastructure.
- The Cloud coordination layer (event log, metadata, identity) runs on UK-region infrastructure. No VodafoneThree data is processed or stored outside the UK by ctxhub Cloud.
- LLM inference (for Captain tasks and `ctxhub explain`) is the one area where prompts containing code context are transmitted to an external provider. **This is under VodafoneThree's control:** ctxhub supports configuration of any OIDC-compatible inference endpoint, including on-premises models, Azure OpenAI Service (UK South region), or other enterprise inference providers. VodafoneThree can route all LLM calls to a UK-hosted endpoint.

---

## LLM inference and code transmission

This is the one area where code-derived content leaves the local environment — when an LLM is asked to reason about code.

**What happens:** When a Captain task runs or a developer calls `ctxhub explain`, the ctxhub runtime constructs a context pack — a curated excerpt from the indexed codebase relevant to the query — and sends it to the configured inference endpoint.

**What is sent:** Relevant code excerpts (not the full codebase), the query or task description, persona configuration.

**What is not sent:** The full codebase, credentials, `.env` content, findings from unrelated tasks.

**Who controls the endpoint:** VodafoneThree configures the inference endpoint. Options:

| Option | Data residency | Notes |
|---|---|---|
| Azure OpenAI Service (UK South) | UK | Microsoft data processing terms; enterprise agreements available |
| Self-hosted model (Ollama, vLLM) | On-premises | No external transmission; performance depends on hardware |
| Anthropic Claude API | US (default) | Appropriate where UK residency is not required for LLM calls |
| Enterprise proxy | Configurable | Supports any OpenAI-compatible API |

For the VodafoneThree UK trial, we recommend Azure OpenAI Service (UK South) or a self-hosted endpoint.

---

## Network architecture

**Inbound connections to VodafoneThree infrastructure:** None required. ctxhub does not require any inbound firewall rules.

**Outbound connections from VodafoneThree machines:**

| Destination | Purpose | Required |
|---|---|---|
| ctxhub Cloud API | Event sync, identity, Mission Control | Yes, for Cloud features |
| Entra ID (login.microsoftonline.com) | Authentication | Yes |
| Inference endpoint | LLM calls | Yes (configurable to VF3-hosted) |
| npm registry | Installation only | One-time |

**Protocol:** HTTPS only. TLS 1.2 minimum.

---

## Audit log

ctxhub maintains an append-only structured audit log covering:

- Authentication events (login, logout, token refresh, failed auth)
- Permission changes (member added/removed, role changes)
- Captain task runs (started, completed, failed)
- Knowledge promotions (finding promoted, note deleted)
- Sync events (workspace sync to Cloud, sync errors)

Log format: structured JSON, one event per line. Queryable by actor, resource, action, and date range. Accessible to workspace owner and admins only.

Audit logs are retained locally and not transmitted to ctxhub Cloud infrastructure.

---

## Threat model summary

| Threat | Mitigation |
|---|---|
| Unauthorised access to code via ctxhub | Code never transmitted to ctxhub Cloud; local index access requires authenticated ctxhub session |
| Credential theft via ctxhub | Passwords never seen by ctxhub; authentication delegated to Entra ID |
| Secret exposure via indexer | `.env` excluded by default; secret patterns redacted before indexing |
| LLM provider data retention | Configurable to on-premises or Azure OpenAI with enterprise DPA |
| Insider threat (ctxhub employee access to VF3 data) | Single-tenant deployment — ctxhub employees have no access to VF3 infrastructure or data |
| Man-in-the-middle on sync | HTTPS with TLS 1.2+; JWT signed with RS256 |
| Token theft / session hijacking | Short-lived access tokens (1hr); refresh tokens rotated on use |
| Privilege escalation | RBAC enforced server-side; no client-side enforcement relied upon |

---

## What is not yet certified

This is an honest statement of current security posture:

- **SOC 2 Type II:** Not yet certified. Audit preparation is on the M9 Enterprise roadmap. A credible architecture with structural controls (as described in this document) is the appropriate basis for a pilot; formal certification follows commercial deployment.
- **Penetration test:** Not yet completed against the Cloud coordination layer. Available on request before the pilot goes live.
- **SCIM provisioning:** Not yet implemented. User provisioning for the pilot uses Entra ID JIT (Just-in-Time) — users are created in ctxhub on first login. SCIM is on the M9 roadmap.

---

## Threats we don't solve

Being explicit about scope builds more trust than implying comprehensive coverage. The following are outside ctxhub's threat model:

**Authorised insider copying.** If a developer has permission to view a repository, ctxhub cannot prevent them from copying that code into another system. ctxhub enforces access controls on its own index and Mission Control — it does not and cannot police what engineers do with code they are legitimately authorised to access.

**Endpoint trust.** ctxhub assumes the machines it runs on are trusted. If a developer's machine is compromised, ctxhub's local index is accessible to whatever has that access. This is a machine security problem, not a ctxhub problem — but it is worth stating explicitly so that endpoint security controls (MDM, disk encryption, EDR) are understood to be complementary, not redundant.

**Inference provider data handling.** ctxhub controls what is sent to the configured inference endpoint. It does not control how that provider handles, retains, or processes the data once received. For the VF3 pilot, we recommend Azure OpenAI Service (Microsoft data processing terms apply) or a self-hosted endpoint to make this fully deterministic.

**Prompt injection via indexed content.** If malicious content is committed to a repository that ctxhub indexes, that content could influence LLM outputs when it appears in a context pack. This is a known class of risk for any RAG system. Mitigation: Captain task findings require human review and approval before promotion; no automated action is taken on raw LLM output.

**Physical access to developer machines.** ctxhub does not encrypt its local LanceDB index at rest beyond what the host OS provides. Full-disk encryption (FileVault, BitLocker, or equivalent) should be enabled on all developer machines — this is standard practice and not specific to ctxhub.

---

## Contact

For questions arising from this review, contact the ctxhub technical team directly via the design partner channel established in the Founding Design Partner Charter.

---

*This document describes ctxhub as of the pilot commencement date. Architecture decisions referenced here are recorded as Architecture Decision Records in `docs/adr/`.*
