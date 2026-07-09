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

- If the `ctxhub` MCP server is connected, prefer its tools: `context_pack`, `search`, `open_chunk`, `get_file_context`, `architecture_search`, `architecture_map`, `memory_status`, `repo_list`.
- For broad questions, use `context_pack` first; it bundles search, architecture, freshness, repo list, and suggested reading order.
- Otherwise, run the CLI directly: `ctxhub search --plain "<query>"`, `ctxhub memory status --plain`, `ctxhub repo list`.
- Run `ctxhub sync --plain` (or ask the user to) if search results look stale; it pulls configured repos and re-indexes changed files.
- Don't run mutating commands like `ctxhub index`, `ctxhub sync` (even with `--plain`), or `ctxhub memory clear` without the user's intent; these mutate the workspace's index/repos.

## Remembering things long-term

This index is a read-only mirror of the workspace's actual repo content. It is not a place to store your own notes, decisions, or session history. If you learn something worth remembering across sessions and MemPalace's MCP server is connected, write it there instead (`mempalace_add_drawer`, `mempalace_checkpoint`, etc.).

## Sharing something with the team

If what you learned is worth a teammate seeing and reviewing, write it as a note in the relevant repo instead of MemPalace. Run `ctxhub note add <repo> "<title>" --agent <your-name>`; it scaffolds a dated, consistently-formatted file under `<repo>/agent-notes/`. Use `ctxhub repo list` if you need the exact repo name.

If the thing worth sharing is architecture or system flow, create a Mermaid diagram instead: `ctxhub diagram add <repo> "<title>" --agent <your-name>`.
