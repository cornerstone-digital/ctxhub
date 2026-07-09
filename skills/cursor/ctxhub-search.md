# Search ctxhub on demand

Treat whatever text follows this command's invocation as the search query.

## What to do

1. If the `ctxhub` MCP server is connected, call its `search` tool with this query.
2. Otherwise, run: `ctxhub search "<query>"` on the command line.
3. Report which repo and file each result came from, with the relevant snippet — don't just paste raw tool output.
4. If nothing relevant comes back, say so plainly rather than guessing an answer from unrelated context; suggest `ctxhub sync` if the results seem like they might be stale.
