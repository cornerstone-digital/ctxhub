---
name: ctxhub
description: Use ctxhub to search this workspace's indexed docs and source before answering questions about existing code, decisions, or documentation across the configured repos.
---

This workspace uses `ctxhub` (see `ctxhub.yaml` / `.ctxhub/config.yaml`) to index documentation and source across its configured repos.

## When to use this

- Before answering questions about how existing code works, where something is implemented, or why a decision was made — check the index first rather than guessing.
- After the user mentions pulling new changes or switching branches, treat the index as possibly stale.

## How to use it

- If the `ctxhub` MCP server is connected, prefer its tools: `search`, `memory_status`, `repo_list`.
- Otherwise, run the CLI directly: `ctxhub search "<query>"`, `ctxhub memory status`, `ctxhub repo list`.
- Run `ctxhub sync` (or ask the user to) if search results look stale — it pulls configured repos and re-indexes changed files.
- Don't run `ctxhub index`, `ctxhub sync`, or `ctxhub memory clear` without the user's intent; these mutate the workspace's index/repos.
