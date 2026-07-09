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
- `ctxhub agent <name>` also wires up MemPalace's own MCP server (`mempalace-mcp`) alongside ctxhub's when it's the configured memory provider and available, so agents get a real write-capable memory surface (`mempalace_add_drawer`, `mempalace_checkpoint`, etc.) for durable, personal/session notes
- `ctxhub note add <repo> "<title>"` scaffolds a dated, consistently-formatted note file under `<repo>/agent-notes/` for anything worth a teammate seeing and reviewing — git-tracked, shows up in the PR diff, and gets indexed like any other doc once merged. Distinct from MemPalace: this is for team-shared, review-worthy notes, not personal/session memory.
- Mermaid architecture diagrams are first-class context: `.mmd`/`.mermaid` files and fenced Mermaid blocks are indexed with extracted component/relationship metadata, `ctxhub diagram add` scaffolds git-tracked diagrams under `docs/architecture/`, and MCP exposes architecture-specific search/map tools.
- Agent context packs (`ctxhub pack` / MCP `context_pack`) combine search, architecture, freshness, repo list, and status into one agent-ready bundle.
- Exact context expansion tools (`open_chunk`, `get_file_context`) let agents move from search snippets to grounded source/doc context.
- Freshness metadata marks stale search results when repo HEAD or dirty state no longer matches the indexed commit.
- `ctxhub eval`, `ctxhub validate docs`, and `ctxhub graph` add search-quality checks, documentation validation, and architecture graph summaries.

## Planned

- AI-generated documentation validation

## Not planned

- ctxhub reimplementing agent write/memory operations itself — MemPalace already ships a full write-capable MCP surface (19 tools including `mempalace_add_drawer`, `mempalace_checkpoint`, `mempalace_diary_write`) for exactly this. ctxhub's job is making sure it's connected (`ctxhub agent <name>` wires up `mempalace-mcp` alongside its own server), not rebuilding it.
- An embeddings/vector-DB index provider — lexical/full-text search already covers this project's typical doc+code corpus well, and a local embedding model would add a second native-binary dependency for modest benefit on identifier-dense content.

Both were deliberately decided against rather than merely deferred.
