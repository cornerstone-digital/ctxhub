Build a reusable, installable CLI called ssd for AI-assisted development workspaces.

Goal:
Create a generic CLI that can be installed globally or used per-project to manage multi-repo AI context, documentation indexing, local memory, and developer workflow automation.

Tech stack:

* TypeScript
* Node.js
* Commander.js for CLI commands
* YAML config
* Local file-based index initially
* Pluggable memory provider interface
* Package should be publishable as an npm CLI

Core requirements:

1. Package structure
    Create a clean TypeScript package with:

* package.json
* tsconfig.json
* src/index.ts
* src/commands/*
* src/config/*
* src/memory/*
* src/indexing/*
* src/git/*
* src/utils/*

The CLI binary should be available as:

ssd

2. Config

Support a project-level config file:

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
  provider: local-json
index:
  incremental: true

Commands should automatically discover config in:

ssd.yaml
.ssd/config.yaml

3. Commands

Implement these commands:

ssd init
ssd repo add <name> <path>
ssd repo list
ssd repo discover [path]
ssd index
ssd sync
ssd search <query>
ssd memory status
ssd memory clear
ssd doctor

4. Behaviour

ssd init

* Creates .ssd/config.yaml
* Creates .ssd/index/
* Creates .ssd/cache/
* Creates .ssd/memory/
* Adds a default config

ssd repo add

* Adds a repo entry to config
* Validates that the path exists
* Detects whether it is a git repo

ssd repo list

* Prints registered repos

ssd repo discover

* Finds git repos under the given path
* Adds them to config or prints candidates

ssd index

* Reads all configured repos
* Applies include/exclude globs
* Indexes markdown files and selected source files
* Stores chunks with metadata:
    * workspace
    * repo
    * path
    * hash
    * commit
    * title/heading if available
    * lastIndexed

ssd sync

* Pulls each git repo
* Detects changed files via hashes
* Re-indexes only changed files
* Removes deleted files from index
* Prints a useful summary

ssd search

* Searches the local index
* Return ranked results with:
    * repo
    * path
    * heading
    * snippet
    * commit

ssd memory status

* Shows provider, document count, chunk count, index location, last indexed

ssd memory clear

* Clears local index/cache after confirmation

ssd doctor

* Checks:
    * Node version
    * Git installed
    * Config exists
    * Repo paths valid
    * Index directory writable
    * Memory provider available

5. Memory provider abstraction

Create an interface like:

export interface MemoryProvider {
  name: string;
  indexDocument(document: IndexedDocument): Promise<void>;
  removeDocument(documentId: string): Promise<void>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  clear(): Promise<void>;
  status(): Promise<MemoryStatus>;
}

Implement LocalJsonMemoryProvider first.

Design it so another provider, e.g. MemPalaceMemoryProvider, can be added later without changing CLI commands.

6. Indexing

Implement simple chunking:

* Split Markdown by headings
* Keep frontmatter if present
* Use file path and heading as metadata
* Store text chunks in JSON files initially
* Use simple lexical scoring for search initially
* Keep code clean so embeddings/vector search can be added later

7. Git utilities

Implement:

* isGitRepo(path)
* getCurrentCommit(path)
* pullRepo(path)
* getRepoName(path)

Use child process safely.

8. UX

Use clear terminal output:

* ticks/crosses
* concise summaries
* actionable errors

Do not make the CLI VF3-specific. It must be reusable for any project.

9. Quality

Add:

* Useful error handling
* TypeScript strict mode
* Unit-testable modules
* README with setup and command examples
* Example ssd.yaml

10. Future extension points

Leave clean TODOs or interfaces for:

* MemPalace provider
* MCP server integration
* Claude/Codex launch integration
* embeddings/vector DB provider
* post-pull/post-commit hooks
* AI-generated documentation validation

Deliverables:

* Complete working TypeScript project
* README
* Example config
* Clear npm scripts:
    * npm run build
    * npm run dev
    * npm run ssd -- <command>

Acceptance criteria:

* I can run npm install
* I can run npm run build
* I can run npm run ssd -- init
* I can add a repo
* I can index docs
* I can search indexed docs
* I can run sync
* I can clear/status memory
* I can install/link the CLI locally using npm link and run ssd