---
name: Blueprint proposal
about: Propose a new packaged set of personas and Captain tasks for a specific stack or domain
labels: blueprint
---

**What stack or domain does this blueprint target?**

e.g. "Next.js + Prisma", "Python FastAPI", "Kubernetes operators", "fintech compliance"

**What problem does it solve for someone using ctxhub on this stack?**

What would their Captains find? What questions would their personas help with? Why is this stack underserved by existing config?

**Proposed Captain tasks**

List the captain task names and their `query` values — what each one asks overnight.

```yaml
- name: security-audit
  query: "Find authentication and authorisation issues in this codebase"
  schedule: "0 3 * * *"
```

**Proposed personas** *(optional)*

What review persona(s) would accompany these captain tasks?

**Do you want to build this, or are you proposing it for someone else to pick up?**

- [ ] I'll build it
- [ ] I'm proposing it for the community

**Anything else?**

Links to relevant docs, frameworks, compliance standards — anything that would help someone build this blueprint well.
