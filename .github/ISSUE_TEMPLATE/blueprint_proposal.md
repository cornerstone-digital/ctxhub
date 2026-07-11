---
name: Blueprint proposal
about: Propose a new packaged set of personas and Captain tasks for a specific stack or domain
title: "Blueprint: "
labels: blueprint
assignees: ''
---

**Blueprint name**

e.g. `fintech-compliance`, `nextjs-prisma`, `kubernetes-operators`

**Target industry / team type**

Who is this for? e.g. "fintech teams running PSD2/PSD3 compliance", "Node.js backend teams using Fastify", "platform engineering teams managing Kubernetes operators"

**Persona and Captain tasks**

What persona(s) and Captain task definitions would this blueprint include? List the task names and their `query` values — what each one asks overnight.

```yaml
personas:
  - name: security-reviewer
    description: "Reviews for auth, input validation, and data handling issues"

captainTasks:
  - name: compliance-audit
    query: "Find PSD2/PSD3 compliance gaps in payment processing code"
    schedule: "0 3 * * *"
  - name: dependency-risk
    query: "Identify third-party dependencies with known CVEs or abandoned maintenance"
    schedule: "0 4 * * 1"
```

**Example knowledge sources**

What kinds of files or docs would this blueprint help index and surface? e.g. API specs, compliance documentation, architecture diagrams, runbooks.

**Would you build this?**

- [ ] Yes, I will build it and open a PR
- [ ] I am proposing it for the community to pick up

**Anything else**

Links to relevant standards, frameworks, or compliance docs. Anything that would help someone build this blueprint well.
