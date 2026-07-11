# ADR-010 — Source code never leaves the local machine

**Date:** July 2026  
**Status:** Accepted

## Context

ctxhub indexes codebases, generates embeddings, and produces AI-generated findings about source code. In a cloud-connected system, there are many points at which source code content could flow to an external service: embedding generation, captain run context, Knowledge Object storage, the LanceDB index.

Developer trust depends on a clear and structural guarantee about what leaves the machine. A policy claim ("we don't store your code") is weaker than an architectural guarantee ("the system is designed so code never reaches Cloud infrastructure").

## Decision

**Source code content is never transmitted to ctxhub Cloud infrastructure. This is enforced structurally, not by policy alone.**

Specifically:
- **LanceDB index** — stored at `~/.ctxhub/` on the local machine. Never synced to Cloud. Cloud has no index sync endpoint.
- **Embeddings** — generated locally using the configured LLM agent (which may be a local model or a remote API the developer controls). ctxhub Cloud never receives embeddings.
- **Captain run context** — the captain runner sends queries to the local LLM agent with full codebase context. Only the result (answer text, citation paths) is stored and potentially synced.
- **Citation paths** — synced to Cloud as part of captain run results. These reveal file paths (e.g. `src/auth/session.ts`) but not file content. Cloud cannot reconstruct source from paths alone.
- **Promoted note content** — synced to Cloud only if the workspace has `content-sync: true` in `ctxhub.yaml`. This is opt-in, default off. Note content contains the promoted finding text (AI-generated commentary) but not raw source code.

What Cloud receives: answers, citation paths, event metadata, stats, workspace names, repo names.  
What Cloud never receives: source file content, embeddings, git history, secrets.

## Consequences

**Positive:**
- Privacy is structural — there is no code path that sends source to Cloud, so there is nothing to misconfigure or accidentally enable
- ctxhub can be used in air-gapped environments, on proprietary codebases, and behind strict data governance policies
- The guarantee is auditable: inspect the sync batch payload; source code content is never present

**Negative:**
- Cloud cannot perform semantic search over the codebase — search is always local
- Cloud-side captain run execution (a later phase) will require a separate, explicit architecture for securely providing codebase context
- Some advanced Organisation Graph features (e.g. topology inference from code imports) must be computed locally and only the results synced

**Constraint to preserve:**
Any feature that would cause source code content to be transmitted to ctxhub Cloud infrastructure requires an explicit architectural decision record and must be opt-in with clear disclosure. This applies to: embedding sync, index sync, raw file content in Knowledge Objects, and any new telemetry.
