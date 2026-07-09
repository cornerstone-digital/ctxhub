---
name: ctxhub-context
description: Build a workspace context pack before answering broad cross-repo questions about architecture, ownership, integrations, decisions, or system behavior. Prefer this over raw search when the user needs a synthesized answer rather than a single lookup.
argument-hint: What question should ctxhub gather workspace context for?
user-invocable: true
disable-model-invocation: false
---

## User input

```text
$ARGUMENTS
```

Treat the invocation text as the question to gather context for. If no question was provided, ask for one concise search/context objective.

## What to do

1. If the `ctxhub` MCP server is connected, call `context_pack` with the question.
2. Otherwise, run: `ctxhub pack --plain "<question>"`.
3. Read the suggested order and cited files before answering.
4. Summarize the answer with repo/file citations where possible.
5. If freshness warnings appear, say so and suggest `ctxhub sync --plain` before relying on the answer.

Use this skill when the answer likely needs several repos, architecture evidence, freshness checks, or a reading path. Use `ctxhub-search` instead for a narrow lookup.
