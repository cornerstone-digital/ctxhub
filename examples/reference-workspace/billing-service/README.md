# billing-service

Creates invoices, processes payments, and publishes billing events for other services to consume.

## Setup

```bash
npm install
npm run start
```

Requires payment-processor credentials in `PAYMENTS_API_KEY`.

## Events published

- `invoice.created` — an invoice was created for a cart, before payment.
- `invoice.paid` — payment succeeded; consumed by `notifications-service` to send a receipt.
- `invoice.payment_failed` — payment failed; `web-app` polls this to show the customer an error.
