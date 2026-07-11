# ADR-014 — Use OpenID Connect with PKCE for enterprise authentication

**Date:** July 2026  
**Status:** Accepted

## Context

Enterprise deployments require SSO integration with corporate identity providers. Storing passwords in ctxhub would create a new credential attack surface and conflict with corporate password policies. We need to delegate authentication to the organisation's existing identity system.

Microsoft Entra ID (formerly Azure Active Directory) is the target IDP for the VF3 and similar enterprise deployments. The OIDC/OAuth 2.0 PKCE flow is the recommended pattern for native and CLI applications — it avoids client secrets, is phishing-resistant, and is well-supported by Entra ID.

## Decision

**Enterprise authentication uses the OpenID Connect authorisation code flow with PKCE. ctxhub never stores passwords.**

Specifically:
- Entra ID is the identity provider; ctxhub acts as a relying party.
- The PKCE flow is initiated by the CLI (`ctxhub login`), which opens a local redirect server to capture the authorisation code.
- ID tokens are validated against the tenant's JWKS endpoint.
- ctxhub issues its own short-lived HS256 JWTs (`ctxhubToken`) from the validated identity, scoped to local API access.
- Community users who do not configure an IDP fall back to unauthenticated local mode.

## Consequences

**Positive:**
- No credential storage; ctxhub cannot be breached for passwords.
- Role mapping can draw on Entra group memberships.
- Standard flow: compatible with any OIDC-compliant IDP, not just Entra.

**Negative:**
- Requires Entra app registration and an administrator to configure `clientId`, `tenantId`, and `jwtSecret`.
- Local-mode fallback means unauthenticated access is still possible if auth is not configured.
- PKCE flow requires a browser; headless CI environments need a separate token path.
