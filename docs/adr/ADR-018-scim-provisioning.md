# ADR-018 — SCIM 2.0 user provisioning

**Date:** July 2026  
**Status:** Accepted

## Context

Enterprise customers provision users from their identity provider (Entra ID, Okta) into company systems. At VodafoneThree scale — hundreds of engineers across three distinct engineering organisations — manual user management in ctxhub is not feasible. Users join and leave teams continuously; credentials must be revoked promptly when someone departs; new hires must get access within hours, not days.

SCIM 2.0 (System for Cross-domain Identity Management) is the industry standard protocol for automated user lifecycle management. Every major enterprise IdP — Entra ID, Okta, OneLogin — supports it as a push-based provisioning mechanism. Implementing SCIM means the IdP owns the user lifecycle and ctxhub reacts to it, rather than ctxhub managing a separate user store in parallel with the IdP.

## Decision

**Implement SCIM 2.0 at `/scim/v2/` on the ctxhub service.**

Specifically:

- Support `Users` and `Groups` resource types at `/scim/v2/Users` and `/scim/v2/Groups`.
- Implement standard SCIM operations: `POST` (create), `GET` (read single + list with `?filter=`), `PUT` (replace), `PATCH` (partial update), `DELETE`.
- Use soft-delete rather than physical delete: setting `active: false` on a `User` marks them as deprovisioned. The record is retained for audit and attribution purposes. Physical deletion of SCIM users is not supported.
- Expose `GET /scim/v2/ServiceProviderConfig` and `GET /scim/v2/Schemas` to enable IdP auto-discovery.
- All SCIM endpoints require a machine token with admin or owner role (`Authorization: Bearer ctxm_...`). The machine token for the IdP is created with `ctxhub machine-token create --name entra-scim --role admin`.
- Deprovisioning events emit `auth.scim_user_deprovisioned` to the audit log.

## Consequences

**Positive:**

- The IdP manages the user lifecycle automatically. New hires appear in ctxhub without manual admin steps; leavers are deprovisioned on their last day by the IdP.
- Deprovisioning is audited: every `active=false` transition is recorded in the append-only audit log, satisfying enterprise compliance requirements.
- ctxhub no longer needs a separate user management UI for enterprise deployments — the IdP is the authoritative source of truth.
- Standard protocol: SCIM is well-documented and supported by IdP integration guides from Microsoft, Okta, and others; no custom integration work required from the customer.

**Negative:**

- The SCIM endpoint must be network-accessible to the IdP. This constrains deployment topology: a ctxhub instance reachable only on localhost cannot be managed via SCIM from a cloud-hosted IdP. Customers must expose the service via a reverse proxy or public URL.
- Machine token management adds an operational step: the IdP integration token (`ctxm_` prefix) must be created before SCIM provisioning can begin, rotated on expiry, and revoked if compromised.
- SCIM `PATCH` with `replace` operations requires careful handling of partial updates to avoid inadvertently clearing fields the IdP does not know about (e.g. ctxhub-specific metadata). The implementation must merge patch operations rather than treating them as full replacements.
- Group membership changes via SCIM (`/scim/v2/Groups` `PATCH members`) must be reflected in ctxhub role resolution at login time, not immediately — roles are resolved from the identity token at token-issuance time, not from the SCIM store directly.
