---
name: ctxhub-search
description: Explicitly search across every repo in this multi-repo workspace on demand when you already know you want a search run right now.
argument-hint: What do you want to search for across this workspace's repos?
---

Treat the user's invocation text as the search query.

## What to do

1. If the `ctxhub` MCP server is connected, call its `search` tool with this query. Use `type: "code"`, `"docs"`, `"architecture"`, or `"notes"` when the user clearly wants that kind of result.
2. Otherwise, run: `ctxhub search --plain "<query>"`. For implementation lookups, prefer `ctxhub search --plain --code "<query>"`; for decisions/docs use `--docs`; for diagrams use `--architecture`; for team notes use `--notes`.
3. Report which repo and file each result came from, with the relevant snippet and result type. Do not just paste raw tool output.
4. For exact method bodies or edits, treat ctxhub as orientation: follow up with `get_file_context`, `ctxhub open <id>`, or local `rg` in the target repo.
5. If nothing relevant comes back, say so plainly rather than guessing an answer from unrelated context; suggest `ctxhub sync --plain` if the results seem like they might be stale.

The CLI and MCP server discover the nearest ctxhub config by walking upward from the current directory, so this works even when the agent was launched inside a configured child repo rather than at the workspace root.
