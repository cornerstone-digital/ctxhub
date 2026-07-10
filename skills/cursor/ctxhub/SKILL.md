---
name: ctxhub
description: Search across every repo in this multi-repo workspace, including repos not currently open, before answering questions about existing code, architecture, ownership, integrations, or past decisions. Provides search, architecture_search, architecture_map, memory_status, and repo_list.
---

This workspace uses `ctxhub` (see `ctxhub.yaml` / `.ctxhub/config.yaml`) to index documentation and source across all of its configured repos, not just the one you happen to have open. ctxhub discovers the nearest config by walking upward from the current directory, so it still works when the agent is launched from inside one configured repo within a larger workspace.

## When to use this

The key differentiator: the answer may live in a different repo than the one currently in context. Reach for this before answering questions like:

- "How does `<other-service>` authenticate/call/consume `<this-service>`?"
- "Which repo owns `<capability>`?"
- "Why was `<decision>` made?" or "what's the history behind `<component>`?"
- "Where is `<thing>` implemented?" when it isn't obviously in the current repo
- "How does this system fit together?" or "what calls what?" - use architecture tools/diagrams first

Also treat the index as possibly stale after the user mentions pulling new changes or switching branches.

## How to use it

- If the `ctxhub` MCP server is connected, prefer its tools: `context_pack`, `search`, `open_chunk`, `get_file_context`, `architecture_search`, `architecture_map`, `memory_status`, `repo_list`, `server_status`.
- For broad questions, use `context_pack` first; it bundles search, architecture, freshness, repo list, and suggested reading order.
- If a result seems to contradict a recent ctxhub change, or once near the start of a long session, call `server_status`. If `stale: true`, ctxhub was rebuilt after this MCP process started and can't restart itself; tell the user to restart/reconnect the ctxhub MCP server (or restart the agent/harness).
- Otherwise, run the CLI directly: `ctxhub search --plain "<query>"`, `ctxhub memory status --plain`, `ctxhub repo list`.
- Use typed search when intent is clear: `ctxhub search --plain --code "<query>"` for implementation/symbol lookup, `--docs` for README/decision docs, `--architecture` for Mermaid diagrams, and `--notes` for team notes.
- For precise code edits, use ctxhub to find the right repo/file, then use local file reads and `rg` in that repo for exact method bodies.
- If search results look stale, tell the user and suggest `ctxhub sync --plain`; it pulls configured repos and re-indexes changed files. Don't run `ctxhub sync`, `ctxhub index`, or `ctxhub memory clear` yourself unless the user explicitly asked for a refresh or index mutation.

## Remembering things long-term

This index is a read-only mirror of the workspace's actual repo content. It is not a place to store your own notes, decisions, or session history. If you learn something worth remembering across sessions and MemPalace's MCP server is connected, write it there instead (`mempalace_add_drawer`, `mempalace_checkpoint`, etc.).

## Sharing something with the team

If what you learned is worth a teammate seeing and reviewing, write it as a note in the relevant repo instead of MemPalace. Run `ctxhub note add <repo> "<title>" --agent <your-name>`; it scaffolds a dated, consistently-formatted file under `<repo>/agent-notes/`. Use `ctxhub repo list` if you need the exact repo name.

If the thing worth sharing is architecture or system flow, create a Mermaid diagram instead: `ctxhub diagram add <repo> "<title>" --agent <your-name>`.
