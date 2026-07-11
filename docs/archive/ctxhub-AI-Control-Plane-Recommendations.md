# ctxhub AI Control Plane Recommendations

## Executive Summary

Build ctxhub as a **local-first AI control plane**.

Core responsibilities: - Workspace Registry - Mission Control
dashboard - Fleet & Workspace Captains - APS Persona engine - Policy &
model routing - Task orchestration - MCP Gateway - Evidence and
provenance

Execution remains the responsibility of external harnesses (Claude Code,
Codex, OpenClaw, Hermes) or API providers.

## Architecture

``` text
User
  ↓
Mission Control
  ↓
ctxhub Control Plane
  ├─ Workspace Registry
  ├─ Fleet Captain
  ├─ Workspace Captain
  ├─ APS Engine
  ├─ Policy Router
  ├─ Task Coordinator
  ├─ MCP Gateway
  └─ Event Bus
        ↓
Workspace Runtime(s)
        ↓
Harness / API
```

## Key Recommendations

### Workspace Registry

-   User-level registry of workspaces.
-   Each workspace keeps its own config, index, memory, personas, tasks
    and policies.
-   Mission Control starts with a Fleet view.

### MCP

-   One central MCP Gateway.
-   Route requests into isolated workspace runtimes.
-   Never merge all workspaces into one global index.

### Mission Control

-   Fleet overview
-   Workspace canvas
-   Captain chat
-   Tasks
-   Activity
-   Reviews
-   Knowledge
-   Approvals

### APS

Separate: - Personas - Skills - Commands - Rooms - Policies - Execution
Policies

### Execution Profiles

Separate: - Harness - Provider - Model

Persona → Execution Profile → Runtime → Provider → Model

### Router Responsibilities

ctxhub owns: - persona policy - workspace policy - permissions -
capability matching - budgets - routing decisions

Gateways own: - provider APIs - retries - failover - load balancing

## Gateway Strategy

Core: - Claude Code - Codex - Generic OpenAI-compatible gateway -
OpenRouter - AWS Bedrock

Optional: - LiteLLM - Portkey - Cloudflare AI Gateway - vLLM Semantic
Router - Enterprise gateways

## LiteLLM

Support as an optional adapter, not a required dependency.

## OpenRouter

Recommended onboarding option for OSS users.

## Bedrock

Recommended first-class enterprise adapter.

## vLLM Semantic Router

Treat as an optional advanced routing backend via a pluggable
TaskClassifier.

## Local-first

Require only: - Node.js - ctxhub

No mandatory Docker, Python or database.

## Roadmap

1.  Workspace Registry
2.  Mission Control
3.  APS
4.  Central MCP Gateway
5.  Fleet Captain
6.  Execution Profiles
7.  OpenRouter & Bedrock
8.  LiteLLM/Portkey
9.  vLLM Semantic Router

## Guiding Principle

ctxhub owns: - orchestration - personas - policies - routing -
evidence - approvals - workspace management

External systems own: - inference - model hosting - provider APIs -
agent execution

This keeps ctxhub vendor-neutral, local-first and extensible.
