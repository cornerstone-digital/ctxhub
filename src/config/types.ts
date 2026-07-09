export type RepoConfig = {
  name: string;
  path: string;
  include?: string[];
  exclude?: string[];
  git?: boolean;
};

export type DevctxConfig = {
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
};

export type IndexProviderName = 'local-json' | 'lancedb';
export type MemoryProviderName = 'local-json' | 'mempalace';

export type IndexedDocument = {
  id: string;
  workspace: string;
  repo: string;
  filePath: string;
  absolutePath: string;
  title?: string;
  content: string;
  hash: string;
  commit?: string;
  lastIndexed: string;
};

export type IndexedChunk = IndexedDocument;

export type SearchResult = IndexedDocument & {
  score: number;
  snippet: string;
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
