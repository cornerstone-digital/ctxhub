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
