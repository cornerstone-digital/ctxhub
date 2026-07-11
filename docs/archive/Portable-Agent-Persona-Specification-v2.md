# Portable Agent Persona Specification (APS) v2

> **Status:** Draft v2
>
> A provider-agnostic specification for defining, composing and
> executing AI agent personas across Claude Code, Codex CLI, OpenClaw,
> Hermes, Cursor, Copilot and future autonomous-agent frameworks.

------------------------------------------------------------------------

# Executive Summary

APS turns personas from provider-specific prompts into reusable,
version-controlled engineering assets.

Rather than writing large system prompts for each model, APS stores
behaviour as Markdown and small manifest files that can be composed
dynamically by an orchestration layer.

The execution harness remains replaceable.

The persona definitions remain portable.

------------------------------------------------------------------------

# Design Principles

APS is:

-   Model agnostic
-   Markdown first
-   Composable
-   Specification-driven
-   Git friendly
-   Reviewable
-   Extensible
-   Local-first

APS intentionally aligns with Specification Driven Development (SDD).

------------------------------------------------------------------------

# Architecture Philosophy

APS is designed to complement---not replace---existing orchestration
frameworks.

Responsibilities are deliberately separated.

  Responsibility          Owned by
  ----------------------- ------------------------------
  Persona definitions     APS
  Context composition     APS
  Policies                APS
  Skills                  APS
  Evidence gathering      ctxhub/OpenClaw/etc
  Agent execution         Claude/Codex/OpenClaw/Hermes
  Long-running autonomy   Orchestrator

**Rule:**

> APS defines behaviour.
>
> The configured harness executes it.

------------------------------------------------------------------------

# Repository Layout

``` text
.ctxhub/
  agents/
    manifest.yaml

    personas/
      architect.md
      implementer.md
      reviewer.md
      researcher.md

    skills/
      review.md
      implement.md
      debug.md
      research.md

    commands/
      review.md
      implement.md
      plan.md

    rooms/
      architecture.md
      security.md
      infrastructure.md
      product.md

    policies/
      evidence.md
      repository-changes.md
      safety.md

    schemas/
      persona.schema.json
```

------------------------------------------------------------------------

# Core Concepts

## Persona

Defines identity and decision making.

Contains:

-   identity
-   responsibilities
-   principles
-   communication style
-   escalation rules

Examples:

-   Architect
-   Reviewer
-   Implementer
-   Product Owner

------------------------------------------------------------------------

## Skill

Reusable capability.

Examples:

-   Review
-   Debug
-   Research
-   Refactor
-   Architecture Analysis

Contains:

-   workflow
-   required evidence
-   quality gates
-   expected outputs

------------------------------------------------------------------------

## Command

Entry point.

Examples:

-   review
-   implement
-   plan

A command selects personas and skills.

------------------------------------------------------------------------

## Room

A room scopes project knowledge.

Example:

``` yaml
name: architecture

include:
  - docs/architecture/**
  - adr/**
  - "**/*.mmd"

tools:
  - architecture_search
  - architecture_map
```

Rooms reference knowledge.

They do not duplicate it.

------------------------------------------------------------------------

## Policy

Policies are mandatory.

Examples:

-   evidence requirements
-   documentation standards
-   destructive action restrictions

Policies always override persona preferences.

------------------------------------------------------------------------

# Persona Template

Each persona should contain:

-   Identity
-   Responsibilities
-   Goals
-   Decision Framework
-   Communication
-   Repository Awareness
-   Collaboration
-   Quality Gates
-   Memory Usage
-   Expected Outputs

------------------------------------------------------------------------

# Capabilities

Personas may declare capabilities.

Example:

``` yaml
requires:
  - workspace-search
  - architecture-map

prefers:
  - native-subagents
```

Harness support determines whether these become native features or
prompt guidance.

------------------------------------------------------------------------

# Manifest

``` yaml
version: 1

personas:

  architect:

    source: personas/architect.md

    defaultSkills:
      - architecture-analysis
      - review

    defaultRooms:
      - architecture

commands:

  review:

    persona: reviewer

    skills:
      - review

policies:

  - policies/evidence.md
```

------------------------------------------------------------------------

# Composition Pipeline

Runtime assembly order:

1.  Runtime safety
2.  Workspace policies
3.  Command contract
4.  Persona
5.  Skills
6.  Rooms
7.  Retrieved evidence
8.  User task

Conflict precedence:

    Runtime safety
        >
    Workspace policy
        >
    Command
        >
    Persona
        >
    Skill
        >
    Room

This prevents reusable assets from accidentally overriding platform
guarantees.

------------------------------------------------------------------------

# Harness Capability Model

``` ts
interface HarnessCapabilities {

    mcpConfig: boolean;

    skills: boolean;

    headlessInvocation: boolean;

    nativeSubagents: boolean;

    nativePersonas: boolean;

    projectInstructions: boolean;
}
```

One capability table should drive every supported harness.

------------------------------------------------------------------------

# Execution Flow

``` text
User Task
      │
      ▼
Persona Resolver
      │
      ▼
Capability Resolver
      │
      ▼
Context Composer
      │
      ▼
Harness Adapter
      │
      ▼
Configured Agent
```

------------------------------------------------------------------------

# Adapter Model

APS should compile into harness-specific assets.

Examples:

-   Claude
-   Codex
-   OpenClaw
-   Hermes
-   Generic Markdown Prompt

APS remains the canonical source.

------------------------------------------------------------------------

# Relationship with ctxhub

APS naturally extends existing ctxhub concepts.

Current features become:

-   Review Profiles → Personas
-   Skills → Skills
-   Harness abstraction → Capability Resolver
-   runAgentPrompt() → Execution layer
-   Context Pack → Evidence
-   Confidence → Evidence scoring
-   Report Graph → Explainability

No duplicate architecture is required.

------------------------------------------------------------------------

# Recommended Roadmap

## Phase 1

-   Markdown personas
-   Manifest
-   Loader
-   Validation

## Phase 2

-   Composition engine
-   Persona inspection
-   Runtime preview

## Phase 3

-   Harness adapters
-   Claude
-   Codex
-   OpenClaw
-   Hermes

## Phase 4

-   Structured review findings
-   Confidence integration
-   Evidence contracts

## Phase 5

-   Host-agent delegation guidance
-   Native sub-agent support
-   Multi-agent collaboration

------------------------------------------------------------------------

# Future Opportunities

-   Session-aware context delta mode
-   Cross-section context deduplication
-   Starter architecture generation during onboarding
-   PR description synthesis
-   Memory consolidation workflows
-   Agent capability negotiation
-   Shared open APS standard

------------------------------------------------------------------------

# Vision

APS enables a future where:

-   Personas are reusable Markdown assets.
-   Skills are reusable Markdown assets.
-   Commands are reusable Markdown assets.
-   Policies are explicit and reviewable.
-   Context is assembled dynamically.
-   Any compatible LLM can participate.
-   Teams avoid vendor lock-in.

The end result is a portable, open, composable agent ecosystem where
orchestration frameworks evolve independently from the personas they
execute.
