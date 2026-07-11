# Why ctxhub Exists

Every engineering team now has two workforces: the humans, and the AI agents they're increasingly relying on. The humans have infrastructure for coordination — Git, GitHub, Jira, Confluence, Slack. The AI agents have none.

Each session starts from scratch. Context is lost when the conversation ends. What one agent learned isn't available to the next. What the team approved last week isn't known to the model running today. Decisions get made, then made again, then made again.

The knowledge doesn't compound. It evaporates.

---

## Why existing tools don't solve it

**Coding assistants** (Cursor, Copilot, Claude) are excellent at writing code within a session. They're not designed to maintain memory across sessions, share context across tools, or accumulate engineering knowledge over time. That's not a criticism — it's a scope decision. They solve a different problem.

**Knowledge bases** (Confluence, Notion, wikis) capture what engineers manually write down. Most engineering decisions never get written down. The ones that do aren't connected to the code that produced them. They're not searchable by an AI. They don't compound.

**Orchestration tools** (LangChain, CrewAI, AutoGen) coordinate agent execution. They don't build shared context, maintain persistent memory across teams, or give humans meaningful visibility and control over what agents are doing and deciding.

None of them are trying to be the coordination layer for an AI engineering workforce. That's the gap.

---

## The three principles

**Open context.** Context infrastructure is more valuable when it's universal. The runtime is open source because context that's locked to one vendor isn't infrastructure — it's a moat for someone else.

**Humans stay in control.** AI proposes. Humans approve. The approval queue isn't bureaucracy — it's how trust gets built. Each approval is evidence that the AI's judgement can be relied on a little more next time.

**Knowledge compounds.** Every engineering decision should make future engineering decisions better. If a feature doesn't contribute to that loop, it doesn't belong in ctxhub.

---

## The mission

Turn every engineering decision into institutional knowledge.

Not stored in someone's head. Not buried in Slack. Not forgotten when an engineer leaves. Searchable, attributable, and compounding — for humans and AI agents alike.

Over time, accumulated engineering knowledge becomes something harder to replicate than any index or search tool: institutional judgement. Not just what decisions were made, but how this specific organisation consistently makes good engineering decisions. That's the long-term asset.

The goal isn't to replace engineers. It's to ensure every interaction between engineers and AI leaves the organisation smarter than it was before.
