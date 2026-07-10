# notifications-service

Sends transactional email/SMS. Consumes events from `billing-service` and exposes a webhook
delivery API for other internal services.

## Setup

```bash
npm install
npm run worker
```

Requires a queue connection string in `QUEUE_URL`.

## Event handling

- Consumes `invoice.paid` from `billing-service` and sends a receipt email to the customer.
- Exposes `POST /webhooks/deliver` for other services that want a webhook fired, with automatic
  retries (see `agent-notes/` for the retry policy and why it's shaped the way it is).
