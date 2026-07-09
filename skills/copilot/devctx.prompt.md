---
description: Use devctx to search this workspace's indexed docs and source before answering questions about existing code, decisions, or documentation across the configured repos.
---

This workspace uses `devctx` (see `devctx.yaml` / `.devctx/config.yaml`) to index documentation and source across its configured repos.

## When to use this

- Before answering questions about how existing code works, where something is implemented, or why a decision was made — check the index first rather than guessing.
- After the user mentions pulling new changes or switching branches, treat the index as possibly stale.

## How to use it

- If the `devctx` MCP server is connected, prefer its tools: `search`, `memory_status`, `repo_list`.
- Otherwise, run the CLI directly: `devctx search "<query>"`, `devctx memory status`, `devctx repo list`.
- Run `devctx sync` (or ask the user to) if search results look stale — it pulls configured repos and re-indexes changed files.
- Don't run `devctx index`, `devctx sync`, or `devctx memory clear` without the user's intent; these mutate the workspace's index/repos.
