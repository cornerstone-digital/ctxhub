---
name: ctxhub
description: Search across every repo in this multi-repo workspace — including ones not currently open — before answering questions about how existing code or services work, architecture, which repo owns what, or why a past decision was made. Provides search, architecture_search, architecture_map, memory_status, and repo_list.
user-invocable: true
disable-model-invocation: false
---

This workspace uses `ctxhub` (see `ctxhub.yaml` / `.ctxhub/config.yaml`) to index documentation and source across *all* of its configured repos, not just the one you happen to have open.

## When to use this

The key differentiator: the answer may live in a **different repo** than the one currently in context. Reach for this before answering questions like:

- "How does `<other-service>` authenticate/call/consume `<this-service>`?"
- "Which repo owns `<capability>`?"
- "Why was `<decision>` made?" or "what's the history behind `<component>`?"
- "Where is `<thing>` implemented?" when it isn't obviously in the current repo
- "How does this system fit together?" or "what calls what?" — use architecture tools/diagrams first

Also treat the index as possibly stale after the user mentions pulling new changes or switching branches.

## How to use it

- If the `ctxhub` MCP server is connected, prefer its tools: `context_pack`, `search`, `open_chunk`, `get_file_context`, `architecture_search`, `architecture_map`, `memory_status`, `repo_list`.
- For broad questions, use `context_pack` first; it bundles search, architecture, freshness, repo list, and suggested reading order.
- Otherwise, run the CLI directly: `ctxhub search --plain "<query>"`, `ctxhub memory status --plain`, `ctxhub repo list`.
- Run `ctxhub sync --plain` (or ask the user to) if search results look stale — it pulls configured repos and re-indexes changed files.
- Don't run mutating commands like `ctxhub index`, `ctxhub sync` (even with `--plain`), or `ctxhub memory clear` without the user's intent; these mutate the workspace's index/repos.

## Remembering things long-term

This index is a read-only mirror of the workspace's actual repo content — it isn't a place to store your own notes, decisions, or session history. If you learn something worth remembering across sessions (a decision, a workaround, a gotcha) and MemPalace's MCP server is connected, write it there instead (`mempalace_add_drawer`, `mempalace_checkpoint`, etc.) — don't try to stuff it into ctxhub's index.

## Sharing something with the team

Different from the above: if what you learned is worth a teammate seeing and reviewing, not just remembering yourself, write it as a note in the relevant repo instead of MemPalace. Run `ctxhub note add <repo> "<title>" --agent <your-name>` — it scaffolds a dated, consistently-formatted file under `<repo>/agent-notes/`. It's git-tracked, so it shows up in the normal PR diff for review, and ctxhub indexes it like any other doc once merged. Use `ctxhub repo list` if you need the exact repo name.

If the thing worth sharing is architecture or system flow, create a Mermaid diagram instead: `ctxhub diagram add <repo> "<title>" --agent <your-name>`. It scaffolds a `.mmd` file under `<repo>/docs/architecture/`; edit it with stable component names and commit it through a normal PR. ctxhub indexes `.mmd`/`.mermaid` files and Mermaid fenced blocks.
