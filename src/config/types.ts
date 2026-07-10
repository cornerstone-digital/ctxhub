export type RepoConfig = {
  name: string;
  path: string;
  include?: string[];
  exclude?: string[];
  git?: boolean;
};

export type CtxhubConfig = {
  version: number;
  workspace: {
    name: string;
  };
  repositories: RepoConfig[];
  knowledge: {
    include: string[];
    exclude: string[];
  };
  memory: {
    provider: MemoryProviderName;
    path: string;
  };
  index: {
    provider: IndexProviderName;
    path: string;
    table: string;
    incremental: boolean;
    chunkSize: number;
    // How many files' read/hash/chunk/summarize "prepare" step runs concurrently during
    // indexing. Optional -- indexer.ts falls back to a sane default when unset. The actual
    // write to the index provider always stays sequential regardless of this value.
    concurrency?: number;
  };
  hooks: {
    postPull?: string;
    postIndex?: string;
  };
  privacy: {
    redactPatterns: string[];
  };
  llm: {
    enabled: boolean;
    agent?: LlmAgentName;
    timeoutMs: number;
  };
  // docs/control-plane.md Phase 4: binds a persona to a specific harness + model, so a workspace
  // with more than one configured agent CLI can say *which* one a given persona should run under,
  // instead of always using the single `llm.agent`/auto-detected default. Additive: a profile is
  // only used when explicitly named (`--profile <name>`); nothing changes for callers that don't.
  executionProfiles: Record<string, ExecutionProfile>;
};

export type ExecutionProfile = {
  // Defaults the framing persona when a command's `--as <persona>` isn't separately given.
  persona?: string;
  runtime: LlmAgentName;
  // Only claude/codex are verified to accept a --model flag today (see src/llm/runAgent.ts);
  // set on copilot/cursor profiles is accepted but currently has no effect on the invocation.
  model?: string;
  tags?: string[];
};

export type IndexProviderName = 'local-json' | 'lancedb';
export type MemoryProviderName = 'local-json' | 'mempalace';
export type LlmAgentName = 'claude' | 'codex' | 'copilot' | 'cursor';

export type IndexedDocument = {
  id: string;
  workspace: string;
  repo: string;
  filePath: string;
  absolutePath: string;
  kind?: 'document' | 'architecture-diagram' | 'file-summary';
  diagramType?: string;
  components?: string[];
  relationships?: string[];
  symbol?: string;
  symbolKind?: 'function' | 'method' | 'class' | 'arrow';
  title?: string;
  content: string;
  redacted?: boolean;
  hash: string;
  commit?: string;
  lastIndexed: string;
};

export type IndexedChunk = IndexedDocument;

export type SearchResult = IndexedDocument & {
  score: number;
  snippet: string;
  freshness?: FreshnessStatus;
};

export type FreshnessStatus = {
  currentCommit?: string;
  indexedCommit?: string;
  repoMissing: boolean;
  dirty: boolean;
  stale: boolean;
  reason?: string;
};

export type MemoryStatus = {
  provider: MemoryProviderName;
  documentCount: number;
  chunkCount: number;
  indexLocation: string;
  lastIndexed?: string;
};

export type IndexStatus = {
  provider: IndexProviderName;
  documentCount: number;
  chunkCount: number;
  indexLocation: string;
  lastIndexed?: string;
};

export type ManifestEntry = {
  repo: string;
  filePath: string;
  absolutePath: string;
  hash: string;
  commit?: string;
  indexedAt: string;
  chunkIds: string[];
};

export type Manifest = {
  version: number;
  workspace: string;
  files: Record<string, ManifestEntry>;
};
