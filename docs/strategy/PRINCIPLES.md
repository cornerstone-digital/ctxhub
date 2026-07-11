# ctxhub Principles

*Three principles. Every product decision should be testable against them.*

---

## Open Context

Context infrastructure is more valuable when it's universal.

The runtime is open source. Context that's locked to one vendor isn't infrastructure — it's a moat for someone else. An agent using ctxhub should work the same whether it's Claude, Codex, Cursor, or a model that doesn't exist yet.

**Test:** Does this feature lock users to a specific model, provider, or platform? If yes, reconsider.

---

## Humans Stay in Control

AI proposes. Humans approve.

The approval queue isn't bureaucracy — it's how trust gets built. Each approval is a data point that says "the AI's judgement can be relied on a little more next time." Skipping that step doesn't make the product faster; it makes it less trustworthy.

AI should feel like another engineer on the team — capable, helpful, and operating within boundaries the team has agreed on.

**Test:** Does this feature increase human visibility and control over AI decisions? If it reduces oversight without a trust foundation, don't build it.

---

## The Loop

Every feature in ctxhub must fit the same pattern:

**Observe → Understand → Recommend → Approve → Remember**

Features that skip **Approve** don't belong. Features that skip **Remember** don't compound.

This applies at every scale — a single Captain finding, a Mission, a team review, an organisation-level recommendation from Engineering Intelligence. The loop is the product. Everything else is implementation.

---

## Knowledge Compounds

Every engineering decision should make future engineering decisions better.

A review approved today should inform a review tomorrow. An ADR generated this week should be searchable next year. A security finding promoted last month should prevent the same mistake from happening again. If a feature doesn't contribute to that loop, it probably doesn't belong in ctxhub.

**Test:** Does this feature increase the quality or quantity of structured engineering knowledge over time? If not, question why it exists.

---

*When in doubt, return to the mission: turn every engineering decision into institutional knowledge.*
