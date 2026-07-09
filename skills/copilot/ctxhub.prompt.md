---
description: Search across every repo in this multi-repo workspace — including ones not currently open — before answering questions about how existing code or services work, which repo owns what, or why a past decision was made. Provides search, memory_status, and repo_list.
---

This workspace uses `ctxhub` (see `ctxhub.yaml` / `.ctxhub/config.yaml`) to index documentation and source across *all* of its configured repos, not just the one you happen to have open.

## When to use this

The key differentiator: the answer may live in a **different repo** than the one currently in context. Reach for this before answering questions like:

- "How does `<other-service>` authenticate/call/consume `<this-service>`?"
- "Which repo owns `<capability>`?"
- "Why was `<decision>` made?" or "what's the history behind `<component>`?"
- "Where is `<thing>` implemented?" when it isn't obviously in the current repo

Also treat the index as possibly stale after the user mentions pulling new changes or switching branches.

## How to use it

- If the `ctxhub` MCP server is connected, prefer its tools: `search`, `memory_status`, `repo_list`.
- Otherwise, run the CLI directly: `ctxhub search "<query>"`, `ctxhub memory status`, `ctxhub repo list`.
- Run `ctxhub sync` (or ask the user to) if search results look stale — it pulls configured repos and re-indexes changed files.
- Don't run `ctxhub index`, `ctxhub sync`, or `ctxhub memory clear` without the user's intent; these mutate the workspace's index/repos.
