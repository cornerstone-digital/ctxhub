# ADR-003 — Push-based sync; Cloud never polls local machines

**Date:** July 2026  
**Status:** Accepted

## Context

When a local ctxhub runtime needs to share data with Cloud, there are two basic models: the local machine pushes data to Cloud, or Cloud pulls data from local machines. A hybrid (Cloud webhooks local when it needs data) is a variant of pull.

Local machines run on developer laptops: behind NAT, on dynamic IPs, behind corporate firewalls, sometimes offline. Cloud cannot reliably reach them. Even if it could, a persistent inbound connection from Cloud to each developer machine would be a security concern.

## Decision

**Local instances push data to Cloud. Cloud never initiates a connection to a local machine.**

The sync model mirrors git push:
- The local `ctxhub service` runs a background sync loop (every 5 minutes when Cloud is configured)
- The loop reads `events.jsonl` from a cursor position, batches recent captain runs and promotions, and POSTs to the Cloud sync API
- The cursor advances only after a successful Cloud acknowledgement
- On failure, the loop retries with exponential backoff and replays from the cursor on reconnect

Team task definitions flow in the reverse direction: after a successful push, the sync loop also GETs current team captain task definitions and applies any updates locally. This is still initiated by the local machine — Cloud does not push to local.

## Consequences

**Positive:**
- Works behind any NAT, firewall, or VPN without network configuration
- No inbound ports required on developer machines
- Offline machines accumulate a backlog and drain it on reconnect — no data loss
- The mental model matches git push: explicit, predictable, recoverable

**Negative:**
- Cloud data is always slightly stale (up to 5 minutes behind)
- Real-time cross-machine visibility is not possible — Cloud Mission Control is historical, not live (see ADR-004)
- Cloud cannot proactively notify local machines; instructions (team tasks, cascade triggers) are delivered as pull responses during the next sync

**Constraint to preserve:**
Cloud must never initiate connections to local machines. Any feature that requires Cloud-to-local communication must be designed as a local-polls-cloud pattern (the local machine checks for instructions on its sync tick), not as a Cloud-pushes-to-local pattern.
