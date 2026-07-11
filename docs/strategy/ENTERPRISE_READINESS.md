# ctxhub Enterprise Readiness

*Last updated: July 2026*

This document is for procurement teams, security reviewers, and engineering leaders evaluating ctxhub for enterprise use. It provides a current-state snapshot of enterprise capabilities, what is planned, and when.

---

## Identity and access

| Capability | Status | Notes |
|---|---|---|
| Microsoft Entra ID SSO (OIDC) | ✓ Current | JIT provisioning; group-to-role mapping |
| Role-based access control (5 roles) | ✓ Current | Owner, admin, member, reader, machine |
| Machine tokens for CI/CD | ✓ Current | Scoped, bcrypt-hashed, 1yr expiry |
| SAML 2.0 | Planned | M9 Enterprise |
| Generic OIDC (non-Entra providers) | Planned | M9 Enterprise |
| SCIM provisioning | Planned | M9 Enterprise |
| Custom roles | Planned | M9 Enterprise |

---

## Data and privacy

| Capability | Status | Notes |
|---|---|---|
| Local-first architecture | ✓ Current | Source code never leaves customer infrastructure — structural guarantee |
| Single-tenant deployment | ✓ Current | Docker Compose + Helm; no shared infrastructure |
| `.env` and secret exclusion | ✓ Current | Default ignore patterns; configurable via `.ctxhubignore` |
| Secret pattern redaction | ✓ Current | Applied before indexing; common API key, PEM, credential patterns |
| UK data residency | ✓ Current | Single-tenant deployment; Cloud coordination layer on UK-region infrastructure |
| Audit log | ✓ Current | Append-only, structured JSON; actor/resource/action/date queryable |
| Data export | Planned | M9 Enterprise |
| Customer-managed encryption keys | Planned | M9 Enterprise |
| Air-gapped deployment | Roadmap | Post-M9; requires self-hosted inference |

---

## Deployment

| Capability | Status | Notes |
|---|---|---|
| Self-hosted (Docker Compose) | ✓ Current | Full local runtime |
| Self-hosted (Helm / Kubernetes) | ✓ Current | Single-tenant; customer-managed infrastructure |
| Cloud-coordinated (ctxhub Cloud) | In development | M6 Cloud MVP; metadata only; no source code |
| On-premises LLM inference | ✓ Current | Configurable inference endpoint; Ollama, vLLM, Azure OpenAI, or any OpenAI-compatible API |
| Multi-region deployment | Planned | M9 Enterprise |
| High-availability configuration | Planned | M9 Enterprise |

---

## Multi-organisation

| Capability | Status | Notes |
|---|---|---|
| Multiple workspaces per organisation | ✓ Current | |
| Cross-workspace visibility (Mission Control) | In development | M6 Cloud MVP |
| Corporate Groups (multi-org, shared parent) | In development | Corporate Group workstream — for organisations like VF UK + Three UK + Voxi under one group |
| Federation (cross-company, independent orgs) | Roadmap | M13 |

---

## Compliance and certification

| Capability | Status | Notes |
|---|---|---|
| Security architecture documentation | ✓ Current | Written; available on request |
| UK data residency statement | ✓ Current | Available on request |
| Architecture Decision Records (ADRs) | ✓ Current | 13 ADRs published in `docs/adr/` |
| Penetration test | Planned | Available before pilot go-live on request |
| SOC 2 Type II | Planned | M9 Enterprise roadmap |
| ISO 27001 | Roadmap | Post-M9 |
| Cyber Essentials / Cyber Essentials Plus | Roadmap | Post-M9 |

---

## Support and SLA

| Capability | Status | Notes |
|---|---|---|
| Dedicated channel (design partners) | ✓ Current | Direct access; no ticketing system |
| Production SLA | Not available | Not offered during pilot or pre-M9 |
| Enterprise support tier | Planned | M9 Enterprise |
| Named support contacts | Planned | M9 Enterprise |

---

## For procurement teams

If you have a specific requirement not covered above, the right conversation to have is with the ctxhub team directly. This document reflects current platform capabilities — enterprise requirements that are broadly applicable move up the roadmap when a design partner surfaces them. Requirements that conflict with ctxhub's platform principles (local-first, open context, humans in control) will not be implemented, and we'll say so clearly rather than commit to something we won't build.

→ See also: [Security Architecture Brief](./SECURITY_ARCHITECTURE_BRIEF.md) · [Design Partner Charter](./DESIGN_PARTNER_CHARTER.md) · [Roadmap](../../ROADMAP.md)
