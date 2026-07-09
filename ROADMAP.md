# Roadmap

## Shipped

- Multi-repo workspace config, repo discovery, and Git-aware indexing
- LanceDB-backed document/source index with full-text search (`ctxhub index` / `ctxhub search`)
- MemPalace as the default durable agent-memory provider, with a `local-json` fallback
- MCP server (`ctxhub mcp`) exposing `search`, `memory_status`, and `repo_list` as read-only tools
- Config-level lifecycle hooks (`hooks.postPull`, `hooks.postIndex`) and a real Git `post-commit` hook (`ctxhub repo hook`)
- Agent launch integration for Claude, Codex, and Copilot (`ctxhub agent <name>`)
- Installable skills/prompt files for Claude, Codex, Copilot, and Cursor (`ctxhub skills install`) — an ambient auto-invoked skill plus a dedicated `ctxhub-search` skill for explicit, argument-driven on-demand search (`/ctxhub-search <query>` in Claude Code/Codex), mirroring spec-kit's one-skill-per-action pattern
- Interactive onboarding wizard (`ctxhub onboard`) that composes init, repo discovery, hooks, memory, agents, and skills into one guided flow
- Standard OSS project scaffolding: LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue/PR templates
- Fully automated semantic versioning and changelog via semantic-release + Conventional Commits (npm publishing intentionally disabled until ready to ship)
- `ctxhub doctor` detects drift: outdated installed skills, outdated agent MCP configs, and config schema version mismatches, each with the exact command to fix it
- Automatic drift nudge on any command after a ctxhub upgrade (once per version, not on every command), via a Commander `preAction` hook

## Planned

- AI-generated documentation validation

## Not planned

- A MemPalace provider for CLI *write* operations — writes should go through MemPalace's own CLI/MCP tools, not this project's document indexer.
- An embeddings/vector-DB index provider — lexical/full-text search already covers this project's typical doc+code corpus well, and a local embedding model would add a second native-binary dependency for modest benefit on identifier-dense content.

Both were deliberately decided against rather than merely deferred.
