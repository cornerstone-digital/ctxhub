# ADR-002 — Local-first architecture; Cloud is optional

**Date:** July 2026  
**Status:** Accepted

## Context

ctxhub needs to decide where the runtime lives and what Cloud's role is. The options are: Cloud-first (Cloud is the system, local is a thin client), hybrid (some features require Cloud), or local-first (the local runtime is complete and self-contained; Cloud is additive).

The target user is a developer who wants their AI tools to understand their codebase better. Their codebase is on their machine. Their LLM agents are configured on their machine. Requiring Cloud connectivity to use basic features creates friction, raises privacy concerns, and introduces a hard dependency on an external service for something that is fundamentally local work.

## Decision

**The local runtime is the complete product. Cloud is a coordination layer that adds team visibility and knowledge sharing. No local feature requires Cloud.**

`ctxhub service` runs fully offline. If Cloud is unreachable, unavailable, or not configured, every local feature — indexing, captain runs, Mission Control at localhost:7342, MCP tools, evals, jobs — continues to work without degradation.

Cloud adds:
- Shared Mission Control across team machines
- Aggregated captain run history and capture rate
- Team-level captain task distribution
- Organisation Graph and promoted knowledge sharing

Cloud never replaces or proxies the local runtime. The local service is not a "local agent" of Cloud — it is the product, and Cloud is an optional extension.

## Consequences

**Positive:**
- Works on a plane, behind a firewall, or without an account
- Source code and LLM execution never leave the machine by default
- Open-source model: the full runtime can be used without any Anthropic/ctxhub infrastructure
- Privacy is structural, not a policy claim — Cloud never has access to what it was never sent
- Enterprise deployment is possible without Cloud dependency

**Negative:**
- Team features require building and maintaining a sync layer (cursor-based push)
- Some capabilities (org-wide timeline, aggregate capture rate) are inherently Cloud-only
- Testing Cloud features requires a running Cloud instance

**Constraint to preserve:**
Never gate a local feature behind Cloud configuration. If a feature requires Cloud to function at all, it belongs in the Cloud tier explicitly, not as a degraded local experience.
