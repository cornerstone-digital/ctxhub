---
description: Use ssd to search this workspace's indexed docs and source before answering questions about existing code, decisions, or documentation across the configured repos.
---

This workspace uses `ssd` (see `ssd.yaml` / `.ssd/config.yaml`) to index documentation and source across its configured repos.

## When to use this

- Before answering questions about how existing code works, where something is implemented, or why a decision was made — check the index first rather than guessing.
- After the user mentions pulling new changes or switching branches, treat the index as possibly stale.

## How to use it

- If the `ssd` MCP server is connected, prefer its tools: `search`, `memory_status`, `repo_list`.
- Otherwise, run the CLI directly: `ssd search "<query>"`, `ssd memory status`, `ssd repo list`.
- Run `ssd sync` (or ask the user to) if search results look stale — it pulls configured repos and re-indexes changed files.
- Don't run `ssd index`, `ssd sync`, or `ssd memory clear` without the user's intent; these mutate the workspace's index/repos.
