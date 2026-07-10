---
agent: example
date: 2026-01-02
---

# Retry policy for webhook delivery

`POST /webhooks/deliver` retries a failed delivery 5 times with exponential backoff (1s, 2s, 4s,
8s, 16s), then gives up and records the failure for manual review rather than retrying forever.

We chose a bounded retry count over infinite retry-with-backoff because an unbounded queue of
retrying webhooks for a permanently-broken receiver (wrong URL, decommissioned endpoint) would
otherwise grow without limit and eventually affect delivery latency for healthy receivers sharing
the same queue. Five attempts over ~30 seconds is enough to ride out a transient blip (a receiver
restarting, a brief network partition) without holding up the queue indefinitely for a receiver
that's actually gone.
