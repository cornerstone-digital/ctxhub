# ADR-011 — LLM execution runs locally in MVP; Cloud execution is a later explicit opt-in

**Date:** July 2026  
**Status:** Accepted

## Context

Captain runs and job steps require LLM inference: the runtime sends a query with codebase context to an AI agent and processes the result. The agent could be: a local model (Ollama), a remote API the developer controls (Anthropic, OpenAI), or a ctxhub Cloud-managed inference service.

Cloud-managed LLM execution is attractive because it would allow captain runs to happen without a local `ctxhub service` running — useful for CI pipelines and headless environments. However, it fundamentally changes the data flow: to run a captain in Cloud, the codebase context must reach Cloud infrastructure. This conflicts with ADR-010 and the local-first principle (ADR-002).

## Decision

**In MVP, all LLM execution runs locally through the configured agent. ctxhub Cloud never executes LLM calls on behalf of a local workspace.**

The local runtime handles all inference:
- Captain runs: local `ctxhub service` sends queries to the configured agent (Claude, Cursor, Copilot, direct API)
- Job steps: same — local execution, local agent
- Eval: local execution

This means:
- Cloud never receives a codebase context payload
- Cloud never holds API keys for LLM providers on behalf of users
- The developer's agent configuration (API keys, models, rate limits) is entirely under their control

**Cloud-side execution is a later phase** with an explicit trigger condition: teams needing to run captains in CI environments or on machines where a local `ctxhub service` is impractical. When built, it must:
- Be explicitly opted into (never the default)
- Use a secure context transfer mechanism (not raw source code)
- Be described in a separate ADR before implementation

"Local preferred, Cloud optional" — the phrasing is deliberate. Cloud execution is an option for specific scenarios, never the preferred or default path.

## Consequences

**Positive:**
- Consistent with ADR-010: no source code context reaches Cloud in MVP
- Developers control their inference costs, rate limits, and model choices
- No API key management infrastructure required in Cloud MVP
- Privacy guarantee holds structurally, not by policy

**Negative:**
- Captain runs cannot run without a local `ctxhub service` active — unsuitable for CI by default
- Users without API access to a capable LLM cannot run captains (they would need a local model)
- Cloud-side execution, when eventually built, is a significant engineering investment

**Constraint to preserve:**
The default path for any LLM call in ctxhub is always local. Cloud execution must be gated behind an explicit configuration flag, clear disclosure, and a separate ADR. Do not add cloud-proxied inference as a convenience feature.
