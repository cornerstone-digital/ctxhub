# web-app

The customer-facing frontend and its backend-for-frontend (BFF) API. Handles login, session
management, and the checkout flow.

## Setup

```bash
npm install
npm run dev
```

Requires `SESSION_SIGNING_KEY` in the environment (see `agent-notes/` for why sessions are signed
opaque tokens rather than JWTs).

## Authentication flow

1. A user logs in via `POST /api/login`.
2. web-app issues an opaque, server-side session token (not a JWT — see the note on why).
3. Every subsequent request carries that token; web-app validates it against its own session
   store before proxying the request to `billing-service` or `notifications-service`.

## Checkout flow

1. web-app collects the cart and calls `billing-service` to create an invoice.
2. On successful payment, `billing-service` publishes an `invoice.paid` event.
3. `notifications-service` consumes that event and sends the customer a receipt email.
