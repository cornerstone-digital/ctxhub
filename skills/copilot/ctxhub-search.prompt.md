---
description: Explicitly search across every repo in this multi-repo workspace on demand. Invoke directly with /ctxhub-search <query> when you already know you want a search run right now.
---

Treat whatever text follows this prompt's invocation as the search query.

## What to do

1. If the `ctxhub` MCP server is connected, call its `search` tool with this query.
2. Otherwise, run: `ctxhub search --plain "<query>"` on the command line.
3. Report which repo and file each result came from, with the relevant snippet — don't just paste raw tool output.
4. If nothing relevant comes back, say so plainly rather than guessing an answer from unrelated context; suggest `ctxhub sync --plain` if the results seem like they might be stale.
