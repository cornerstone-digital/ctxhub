# ctxhub Compliance Documentation

*For enterprise security reviews. This document describes product features and architectural controls that support compliance readiness. It does not constitute certification. Where third-party audits are required, that requirement is stated explicitly.*

---

## SOC 2 Type II Readiness

SOC 2 Type II certification requires an independent audit by a licensed CPA firm against the AICPA Trust Service Criteria over a defined period (typically six to twelve months). ctxhub has not yet undergone that audit. This section describes the controls in place for each criterion.

### Security (CC6–CC9)

**Authentication and authorisation**

- OIDC-based login with PKCE (RFC 7636) — no client secret transmitted in the browser; state parameter prevents CSRF. Supported providers: Microsoft Entra ID (primary), Okta, Google Workspace, and any RFC 8414-compliant OIDC issuer.
- Five-role RBAC: `owner`, `admin`, `member`, `reader`, `machine`. Role resolution uses Entra group claims (Security Group membership claims) mapped via `ctxhub auth role-map`.
- Machine tokens (`ctxm_` prefix): scrypt-hashed (N=16384, r=8, p=1), 64-byte random source, one-year expiry, revocable at any time via `ctxhub machine-token revoke`. Stored as a hash only; raw token is shown once on creation and never logged.
- SCIM 2.0 provisioning and deprovisioning: IdP-initiated user lifecycle via `POST/GET/PUT/PATCH/DELETE /scim/v2/Users`. Deprovisioning sets `active: false` and emits an `auth.scim_user_deprovisioned` audit event.

**Transport security**

- The HTTP service binds to `127.0.0.1` by default. TLS is delegated to a reverse proxy (nginx, Caddy, AWS ALB) in production deployments. The self-hosted deployment package (`docs/deploy/SELF_HOSTED.md`) documents this boundary explicitly.

**Security headers**

Every HTTP response carries: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: default-src 'self'`.

**Rate limiting**

In-memory per-IP rate limiting: `/auth/*` routes limited to 10 req/min (brute-force mitigation); all other routes limited to 100 req/min. Windows reset at whole-minute boundaries.

**Request size limits**

1 MB request body cap enforced via `Content-Length` pre-check and streaming guard; returns HTTP 413.

**HMAC webhook signatures**

Inbound webhook verification via `X-Hub-Signature-256: sha256=<hex>` (GitHub-style) using HMAC-SHA256 with a per-deployment secret. Configured via `ctxhub webhook set-secret`.

---

### Availability (A1)

- **Local-first design**: the service runs on the developer's machine or the organisation's single-tenant infrastructure. There is no dependency on ctxhub-managed SaaS infrastructure for core functionality; an outage at Anthropic or any cloud provider does not affect indexed knowledge or CLI operations.
- **Health check endpoint**: `GET /health` returns `{ status: 'ok', version }` with no authentication requirement. Suitable for load balancer health checks and monitoring.
- **Docker Compose and Helm deployment**: the self-hosted package (`helm/ctxhub/`) includes restart policies and liveness probes. See `docs/deploy/SELF_HOSTED.md`.
- **`ctxhub doctor`**: built-in health diagnostic that validates config, index, auth, and connectivity. Enterprise mode (`--enterprise`) adds auth-configuration and role-map checks.

---

### Confidentiality (C1)

- **Local data storage**: all indexed knowledge, captain findings, promoted notes, and configuration remain on the operator's hardware. No source code or indexed content is transmitted to ctxhub-managed infrastructure in the default deployment.
- **`.ctxhubignore` filtering**: a `.ctxhubignore` file in the workspace root excludes files and directories from indexing. Default patterns always applied: `.env`, `*.key`, `*.pem`, `secrets/`, `credentials/`, and similar. See `docs/ctxhubignore.md`.
- **Trust tier gating on cross-org sharing**: indexed chunks carry a `ChunkTrustTier` field. Cross-org search is filtered to `institutional+` tier only; unpromoted, unreviewed, or draft-tier chunks never cross an org boundary.
- **TLS for any cloud sync**: when `ctxhub cloud configure` is used to sync promoted chunks to a Cloud endpoint, the endpoint URL is required to use HTTPS. Plain HTTP endpoints are rejected.
- **Machine token storage**: raw tokens are never written to disk. The `machine-tokens.json` store contains scrypt hashes only.

---

### Processing Integrity (PI1)

- **Append-only audit log**: all auth events, group mutations, and SCIM provisioning events are appended to a JSONL log. Existing entries are never modified or deleted by the application. Log path: `~/.ctxhub/audit.jsonl`.
- **Event types for all mutations**: every state-changing operation publishes a typed event to the in-process event bus, which is persisted to `events.jsonl`. Event types include: `auth.login`, `auth.logout`, `auth.machine_token_created`, `auth.machine_token_revoked`, `auth.scim_user_deprovisioned`, `group.created`, `group.org_added`, `group.org_removed`, `group.sharing_updated`, `captain.run.promoted`, `index.completed`.
- **No silent overwrites**: workspace config saves use atomic write (write to temp file + rename). Duplicate workspace registration is a no-op, not a silent overwrite.

---

### Privacy (P1–P8)

- **Data minimisation**: the knowledge indexer processes developer documentation, source code, and runbooks. Chunks are semantic excerpts, not full file copies. Raw source files are not transmitted.
- **SCIM provisioning and deprovisioning**: automated user lifecycle management from the IdP. Deprovisioning (`active: false`) is an immediate operation that prevents further API access.
- **Machine token revocation**: any machine token can be revoked instantly via `ctxhub machine-token revoke <id>`. The token is checked against the store on every request; revoked tokens are rejected at the middleware layer.
- **Tenant isolation**: each ctxhub deployment is single-tenant. There is no shared database or shared indexing infrastructure across customers.

---

## ISO 27001 Control Mapping (Abbreviated)

This table maps selected ISO/IEC 27001:2022 Annex A controls to ctxhub features. Controls not listed are either not applicable to this product category or are addressed by the operator's deployment environment.

| Control | Title | ctxhub implementation |
|---------|-------|----------------------|
| A.5.9 | Inventory of information and other associated assets | Workspace registry (`~/.ctxhub/registry.json`); indexed chunks carry workspace, repo, and file metadata |
| A.8.2 | Access rights management | Five-role RBAC (`owner`, `admin`, `member`, `reader`, `machine`); workspace-scoped role overrides; `ctxhub workspace grant/revoke` |
| A.8.3 | Information access restriction | `allowedRoles` per workspace; cross-org sharing restricted to `institutional+` trust tier; `.ctxhubignore` exclusion list |
| A.8.5 | Secure authentication | OIDC + PKCE (RFC 7636); machine tokens with scrypt hashing; no password storage |
| A.8.6 | Capacity management | Local-first deployment; no shared infrastructure; operator controls their own resource allocation |
| A.8.15 | Logging | Append-only JSONL audit log; all auth, group, and SCIM events logged with actor, timestamp, and action |
| A.8.17 | Clock synchronisation | Timestamps use `new Date().toISOString()` (Node.js system clock); operators are responsible for NTP configuration |
| A.5.14 | Information transfer | TLS enforced for cloud sync endpoints; cross-org search uses HTTPS peer URLs; data boundary documented in `docs/security/DATA_BOUNDARY.md` |
| A.8.24 | Use of cryptography | HMAC-SHA256 JWT signing; scrypt for machine token hashing; HMAC-SHA256 for webhook signature verification |
| A.8.31 | Separation of development, test, and production environments | Single-tenant deployment model; each environment is an independent ctxhub instance with its own credentials |
| A.5.33 | Protection of records | Audit log is append-only; no application-level delete operation; operators are responsible for filesystem-level access controls |
| A.6.1 | Screening | Not applicable — ctxhub is a software product, not a staffing process |
| A.8.9 | Configuration management | `ctxhub auth configure`, `ctxhub workspace set-roles`, and `ctxhub cloud configure` provide structured configuration with audit events on changes |

---

## HIPAA Applicability

ctxhub does not process Protected Health Information (PHI) by design.

The knowledge indexer is built for developer documentation, source code, architecture decision records, runbooks, and technical notes — not patient records, clinical data, or health-related personal data.

**If a customer's codebase or documentation contains PHI**, it is the customer's responsibility to exclude those files from indexing using `.ctxhubignore`. Default exclusion patterns are applied automatically; customers should add explicit patterns for any health-data directories (e.g., `patient-data/`, `ehr/`, `*.hl7`).

ctxhub does not currently offer a Business Associate Agreement (BAA) as a standard contract. Customers who require a BAA should contact Anthropic directly to discuss their specific deployment context.

**BAA template language (for reference — not a legally executed agreement):**

> *[VENDOR] agrees to: (a) not use or further disclose Protected Health Information other than as permitted or required by this Agreement or as Required by Law; (b) use appropriate safeguards to prevent use or disclosure of Protected Health Information other than as provided for by this Agreement; (c) report to [COVERED ENTITY] any use or disclosure of Protected Health Information not provided for by this Agreement of which [VENDOR] becomes aware; (d) ensure that any agents, including a subcontractor, to whom [VENDOR] provides Protected Health Information agree to the same restrictions and conditions that apply to [VENDOR] with respect to such information.*

Customers should have this language reviewed and executed by their own legal counsel before relying on it.

---

## PCI DSS Applicability

ctxhub does not process, store, or transmit cardholder data (CHD) or sensitive authentication data (SAD) by design.

The product indexes developer documentation and source code for knowledge retrieval. It does not handle payment transactions, card numbers, CVV values, PINs, or any data elements defined in the PCI DSS Cardholder Data Environment (CDE).

**If a customer's codebase contains payment-related files** (e.g., payment gateway configurations, card number test fixtures, or PCI-scoped documentation), those files should be excluded from indexing using `.ctxhubignore`. Example patterns:

```
# Example .ctxhubignore entries for PCI-scoped files
payment/
pci/
*card-number*
*cvv*
*pan-data*
```

ctxhub is not a PCI DSS-scoped system in a standard deployment. Operators who deploy ctxhub in an environment that is in scope for PCI DSS should conduct their own assessment of whether the deployment introduces additional CDE scope, and should consult their Qualified Security Assessor (QSA).

---

## Summary Table

| Framework | Status | Notes |
|-----------|--------|-------|
| SOC 2 Type II | Readiness controls in place; not yet audited | Requires independent CPA firm audit |
| ISO 27001 | Controls mapped; not certified | Certification requires a third-party accreditation body |
| HIPAA | Not a covered entity; no PHI processed by design | Customer responsibility to exclude PHI via `.ctxhubignore` |
| PCI DSS | Not in CDE scope by design | Customer responsibility to exclude CDE data via `.ctxhubignore` |
| GDPR | Single-tenant, local-first; no cross-border transfer by default | Operator is the data controller; see `DATA_BOUNDARY.md` |

*For questions about compliance documentation, security architecture, or enterprise deployment, contact the ctxhub team.*
