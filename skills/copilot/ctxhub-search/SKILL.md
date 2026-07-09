---
name: ctxhub-search
description: Explicitly search across every repo in this multi-repo workspace on demand when you already know you want a search run right now.
argument-hint: What do you want to search for across this workspace's repos?
---

Treat the user's invocation text as the search query.

## What to do

1. If the `ctxhub` MCP server is connected, call its `search` tool with this query.
2. Otherwise, run: `ctxhub search --plain "<query>"` on the command line.
3. Report which repo and file each result came from, with the relevant snippet. Do not just paste raw tool output.
4. If nothing relevant comes back, say so plainly rather than guessing an answer from unrelated context; suggest `ctxhub sync --plain` if the results seem like they might be stale.

The CLI and MCP server discover the nearest ctxhub config by walking upward from the current directory, so this works even when the agent was launched inside a configured child repo rather than at the workspace root.
