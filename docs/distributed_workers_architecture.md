# ctxhub Distributed Workers (Bring Your Own Runtime)
Architecture Design Document — v1
*Status: Draft · July 2026*

## 1. The promise

**"Run AI where your infrastructure already lives."**

Mission Control can dispatch work to registered execution environments instead of requiring every credential, every internal system, and every piece of infrastructure access to be centralised in ctxhub Cloud. Work moves to where the trust already exists, rather than trust moving to where the work is defined.

## 2. The problem this solves

Most AI systems assume a simple shape: LLM calls APIs, done. That holds until the work requires cloning a real repository, running a build, executing tests, talking to an internal system, calling Datadog, SSHing into infrastructure, running `kubectl`, or executing Terraform. At that point, the naive approach is to centralise credentials for all of it in the cloud service — which is exactly the trust problem [ADR-002](adr/ADR-002-local-first-cloud-optional.md) and [ADR-010](adr/ADR-010-source-code-never-leaves-the-machine.md) already reject for source code and LLM execution.

Distributed Workers is the same answer applied to a broader category: **don't centralise the credential, dispatch the job to wherever the credential already lives.**

```
Mission Control
      │
      │  dispatches a job (parameters + expected evidence, not credentials)
      ▼
Registered Runtime
      │
      │  has its own local credentials (git, cloud CLI, Datadog token, kubeconfig, ...)
      ▼
Runs the job locally
      │
      ▼
Returns evidence
      │
      ▼
Mission Control records it (Knowledge Object, audit log)
```

Mission Control never receives the credential. It receives the *result*, with provenance.

## 3. Terminology — runtime, worker, job

Precision matters here because "agent" undersells what's being registered and overclaims what's required:

- **Runtime** — the execution environment itself: a developer's laptop, a GitHub Actions runner, a Kubernetes pod, an ECS task, a Lambda, an on-prem server, even a Raspberry Pi. A runtime is infrastructure, not intelligence.
- **Worker** — a process running inside a registered runtime that can execute jobs. A runtime can host one or more workers (a Captain, an MCP server, a plain shell-command executor) — or, per the point above, no AI process at all. A worker advertising `capabilities: [datadog, kubectl]` might just be a thin credentialed wrapper around the Datadog API and `kubectl`, with no model in the loop.
- **Job** — a unit of dispatched work: parameters in, evidence out. Mission Control defines what evidence it expects; it does not need to know or care how the worker produces it.

This is deliberately **not** called "Bring Your Own Agent." An agent is one thing a worker might run. The primitive being registered is compute with local trust, not intelligence — exactly the distinction that makes this composable with everything else on the platform (a worker might run zero AI processes and still be useful purely as a credentialed executor).

## 4. Architecture — mirrors CI runner registration, deliberately

The closest existing mental model is GitHub Actions self-hosted runners, and the architecture borrows that shape on purpose rather than inventing new vocabulary for a well-understood pattern:

```
ctxhub worker register
      │
      ▼
Worker token issued (scoped, revocable — same shape as machine tokens, ADR: Auth machine tokens)
      │
      ▼
Runtime connects over TLS, advertises capabilities
      │
      ▼
Heartbeat (liveness; same event-bus pattern as everything else in Mission Control)
      │
      ▼
Mission Control's worker registry: name, capabilities, trust tier, last heartbeat, audit history
```

### Capabilities, not agent selection

A worker advertises what it can do, not which model it runs:

```yaml
worker:
  id: uk-dev-001
capabilities:
  - git
  - docker
  - node
  - python
  - datadog
  - aws
  - kubernetes
  - terraform
  - playwright
  - mcp
```

Job dispatch is then a capability match — "which registered worker can satisfy `[datadog, python, git]`?" — not a question of "which agent should handle this." This is the same shift M9's OIDC work already made for identity providers (a config label, not a class hierarchy) and this document's sibling, [monorepo_architecture.md](monorepo_architecture.md), makes for build tools (an adapter, not a special case): the *implementation* behind a capability is a plugin, never threaded through the core dispatch logic.

### Job routing

```
Job: "Investigate Datadog alert #4471"
  requires: [datadog, python, git]
        │
        ▼
Mission Control scans registered workers for a capability match
        │
        ▼
Worker A: [datadog ✓, python ✓, git ✓, kubernetes] → eligible
Worker B: [aws, terraform]                          → not eligible
        │
        ▼
Dispatch to Worker A
```

### Disposability

Workers are meant to be ephemeral, exactly like CI runners: a worker joins, runs jobs, leaves. Another worker with overlapping capabilities picks up the next matching job. Nothing about job routing depends on a specific worker's continued existence — the registry is a live capability index, not a fixed topology.

## 5. Security model

This is the section that makes the feature enterprise-relevant, not just architecturally tidy.

**What workers never receive from Mission Control:**
- Organisation secrets or credentials for systems the worker doesn't already have its own access to
- Source code, unless it's already local to that runtime (consistent with ADR-010 — ctxhub Cloud has never held source code, and this doesn't change that)
- Cloud infrastructure credentials belonging to other workers or to Mission Control itself

**What Mission Control sends a worker:** a job definition — parameters and the evidence it expects back. That's the entire payload.

**What a worker authenticates with:** its own identity (worker token, scoped and revocable — the same token shape and lifecycle as the existing machine-token model in `src/auth/machineTokenStore.ts`, not a new credential system). A worker's trust tier determines what classes of job it's eligible to be dispatched, following the same "nothing escalates without a human decision" principle as [trust_model.md](trust_model.md) — a newly-registered worker starts at the lowest trust tier and earns broader eligibility the same way a Knowledge Object earns confidence: through evidence (successful, reviewed job runs), not by declaration.

**Consequence:** Mission Control never becomes a bigger target for credential theft as more integrations get added, because it never held those credentials to begin with. Adding a Terraform worker doesn't mean ctxhub Cloud now needs infrastructure-admin credentials — it means whoever already has those credentials registers a runtime that has them locally.

## 6. Where this composes with what's already built

This isn't a standalone feature — it's a new first-class entity that several existing systems already have a natural relationship to:

- **[Corporate Groups](adr/ADR-015-corporate-groups.md)** define who owns a runtime and which orgs its workers can be dispatched jobs on behalf of.
- **[Trust Model](trust_model.md)** defines what a worker is allowed to do before/after human review of its job history — the same escalation philosophy already governing Knowledge Objects applies to workers.
- **Identity/Auth** (`src/auth/`) authenticates the worker itself, reusing the machine-token pattern rather than inventing a parallel credential system.
- **[Organisation Graph](org_graph_architecture.md)** records job evidence as Knowledge Objects with full provenance (which worker, which job, which runtime) — a job's output is a promoted finding like any other, not a special case.
- **Captains** (`src/captains/`) are one thing a worker can run, not the only thing — a worker with `capabilities: [datadog]` and no Captain at all is equally valid.

A worker is not "an agent running somewhere." It's a registered entity with an identity, a capability list, a trust tier, an audit history, and a health status — the same shape as every other first-class entity on the platform.

## 7. Phasing

Following the same phase-gate discipline as the rest of this roadmap (ADR-009, ADR-013): this is architecture, not a build commitment. No worker registration protocol gets built until a real trigger makes manual/local-only Captain execution the actual blocker.

| Phase | Trigger | Deliverable |
| --- | --- | --- |
| Phase 0 — Today's implicit runtime | Always true | Every self-hosted `ctxhub` instance is already, implicitly, a single unregistered runtime running its own Captains locally. Nothing to build; this is the starting point the rest of the phasing extends. |
| Phase 1 — Worker registration protocol | An org on the enterprise track needs Captain execution to happen somewhere other than the single machine running `ctxhub service` — most likely CI (GitHub Actions) as the first case, since it's the most standardised runtime shape | `ctxhub worker register`, worker tokens (reusing `machineTokenStore.ts`'s shape), heartbeat, a worker registry in the Cloud service (same "in-memory stub" pattern as the rest of `src/cloud/service.ts` until Postgres-backing is warranted) |
| Phase 2 — Capability-based job dispatch | Two or more workers are registered and job routing by hand becomes the bottleneck | Capability advertisement, job/worker matching, dispatch |
| Phase 3 — Non-Captain workers | A real request for a worker that's purely a credentialed executor (e.g. a Datadog investigation job) with no AI reasoning involved | Prove a worker can be useful with zero AI process running — the strongest evidence the "runtime, not agent" framing is correct |
| Phase 4 — Fleet-scale dispatch | An org registers enough workers (multiple regions, multiple teams) that "which worker" becomes a real scheduling problem, not just a capability filter | Locality-aware and load-aware dispatch |

## 8. We expect to learn

- Is CI (GitHub Actions runners) actually the first real demand, or is it developer laptops wanting to offload long-running Captain jobs?
- Does capability-based routing stay simple as capability lists grow, or does it need a richer constraint language (versions, regions, cost) sooner than expected?
- Do organisations trust worker-reported evidence without additional verification, or does every worker-produced finding need the same human-promotion gate local Captain runs already require?
- Is the CI-runner mental model (register, heartbeat, dispatch, disposable) actually the right fit, or does a "worker" behave differently enough from a CI runner (long-lived identity vs. ephemeral) that the analogy breaks down in practice?

## 9. Exit condition

An engineering org registers a worker running somewhere other than a developer's own machine — a GitHub Actions runner is the most likely first case — and a real Captain job dispatched to it produces a promoted Knowledge Object with full provenance, without Mission Control ever holding a credential that worker used.

## 10. Explicitly not in scope here

- A visual workflow/orchestration builder — job definitions are what a Captain task already is (`src/captains/tasks.ts`), not a new authoring surface.
- Billing or metering for worker compute — a commercial question for whenever this is real, not an architecture question today.
- Any specific worker implementation (a Datadog worker, a Terraform worker, etc.) or the registration protocol itself. This document is the design; nothing here has been built. See ROADMAP.md for trigger status.

*ctxhub Distributed Workers · v1 · Draft · July 2026*
