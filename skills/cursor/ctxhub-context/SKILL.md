---
name: ctxhub-context
description: Build a workspace context pack before answering broad cross-repo questions about architecture, ownership, integrations, decisions, or system behavior.
argument-hint: What question should ctxhub gather workspace context for?
---

Treat the user's invocation text as the question to gather context for.

## What to do

1. If the `ctxhub` MCP server is connected, call `context_pack` with the question.
2. Otherwise, run: `ctxhub pack --plain "<question>"`.
3. Read the suggested order and cited files before answering.
4. Summarize the answer with repo/file citations where possible.
5. Use `localFollowUpCommands` from the context pack, or local `rg`, when the next step is exact source-code inspection rather than workspace orientation.
6. If freshness warnings appear, say so and suggest `ctxhub sync --plain` before relying on the answer.

Use this skill when the answer likely needs several repos, architecture evidence, freshness checks, or a reading path. Use `ctxhub-search` instead for a narrow lookup.
