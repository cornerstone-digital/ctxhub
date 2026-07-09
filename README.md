# SSD CLI

`ssd` is a reusable CLI for AI-assisted development workspaces. It manages multi-repo context, indexes local documentation and source files in LanceDB, and leaves durable agent memory to MemPalace by default.

## Install

```bash
npm install
npm run build
npm link
```

For local development:

```bash
npm run ssd -- --help
```

## Quick Start

```bash
ssd init --name my-workspace
ssd repo add app ./app
ssd repo discover ../
ssd repo list
ssd index
ssd search "authentication flow"
ssd sync
ssd memory status
ssd doctor
```

`ssd init` creates:

- `.ssd/config.yaml`
- `.ssd/index/`
- `.ssd/cache/`
- `.ssd/memory/`

Config is discovered from `ssd.yaml` first, then `.ssd/config.yaml`.

By default, `ssd search` uses the LanceDB-backed project index. MemPalace is configured separately as the durable agent memory layer so Claude/Codex/MCP clients can recall project decisions and session history without mixing that data into the source/document index.

## Config

See [ssd.example.yaml](./ssd.example.yaml).

```yaml
version: 1
workspace:
  name: my-workspace
repositories:
  - name: app
    path: ./app
    include:
      - "README.md"
      - "docs/**/*.md"
      - "adr/**/*.md"
    exclude:
      - "node_modules/**"
      - ".git/**"
      - "dist/**"
memory:
  provider: mempalace
  path: .ssd/memory/mempalace
index:
  provider: lancedb
  path: .ssd/index/lancedb
  table: ssd_chunks
  incremental: true
  chunkSize: 1800
```

## Commands

- `ssd init`: create workspace config and local SSD directories.
- `ssd repo add <name> <path>`: add a repo, validate the path, and detect Git.
- `ssd repo list`: print configured repos.
- `ssd repo discover [path]`: find Git repositories below a folder and add them.
- `ssd index`: index changed workspace files.
- `ssd sync`: pull configured repos and re-index changed files.
- `ssd search <query>`: search the LanceDB project index.
- `ssd memory status`: show MemPalace memory status and LanceDB index status.
- `ssd memory clear`: clear the SSD index after confirmation; external MemPalace stores are left to MemPalace.
- `ssd doctor`: check Node, Git, config, repo paths, index directory, and memory provider.

## Extension Points

The index API lives in `src/indexing/IndexProvider.ts`. LanceDB is the default implementation, with local JSON available as a fallback.

The memory API lives in `src/memory/MemoryAdapter.ts`. MemPalace is the default durable memory provider, and local JSON remains available for simple/offline experiments.

Planned extension points:

- MemPalace provider
- MCP server integration
- Claude/Codex launch integration
- embeddings/vector DB provider
- post-pull/post-commit hooks
