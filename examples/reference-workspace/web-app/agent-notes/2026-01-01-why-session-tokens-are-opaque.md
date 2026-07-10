---
agent: example
date: 2026-01-01
---

# Why session tokens are opaque, not JWTs

We deliberately use an opaque, server-side-validated session token instead of a JWT for
`web-app`'s login flow.

A JWT would let `billing-service`/`notifications-service` validate sessions without calling back
to `web-app`, but it also means a compromised or leaked token can't be revoked before it expires —
the whole point of a JWT is that downstream services *don't* need to check back with the issuer.
For a consumer-facing login flow, we'd rather pay the extra internal request per call and keep the
ability to revoke a session immediately (support ticket, fraud flag, password reset) than accept
that tradeoff.

If we ever need cross-service validation without a callback (e.g. a new internal service that
can't easily reach `web-app`), revisit this — a short-lived JWT *in addition to* the opaque
session token, not a replacement for it, is the likely shape of that change.
