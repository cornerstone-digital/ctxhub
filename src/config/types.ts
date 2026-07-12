export type RepoConfig = {
  name: string;
  path: string;
  include?: string[];
  exclude?: string[];
  git?: boolean;
};

// ADR-020 / docs/evidence_sources_architecture.md: a workspace's root concept is Evidence
// Sources, not Repositories. This union is additive alongside `repositories` -- git keeps
// working through RepoConfig unchanged; this is where non-git adapter configs land.
export type LandRegistryEvidenceSourceConfig = {
  kind: 'land-registry';
  name: string;
  /** UK postcode outcode, e.g. 'SW1A'. Matches Land Registry's own postcode filter. */
  postcodeArea: string;
  /** ISO date. Defaults to the last 12 months when absent. */
  sinceDate?: string;
};

export type EvidenceSourceConfig = LandRegistryEvidenceSourceConfig;

export type CtxhubConfig = {
  version: number;
  workspace: {
    name: string;
    /** Optional list of ctxhub roles that may access this workspace over HTTP. When absent, any authenticated user may access it. */
    allowedRoles?: string[];
    /** Per-member role overrides: sub → role. Overrides the member's global role for this workspace only. */
    memberOverrides?: Record<string, string>;
  };
  repositories: RepoConfig[];
  // Additive alongside `repositories` -- see ADR-020. Optional: absent/empty means
  // no non-git evidence sources are configured, and nothing about indexing changes.
  evidenceSources?: EvidenceSourceConfig[];
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
    /** Ordered Execution Profile names to try when the primary route fails. */
    fallbackProfiles?: string[];
  };
  // docs/control-plane.md Phase 4: binds a persona to a specific harness + model, so a workspace
  // with more than one configured agent CLI can say *which* one a given persona should run under,
  // instead of always using the single `llm.agent`/auto-detected default. Additive: a profile is
  // only used when explicitly named (`--profile <name>`); nothing changes for callers that don't.
  executionProfiles: Record<string, ExecutionProfile>;
  // Which executionProfile is currently selected in Mission Control for Captain/Job runs.
  // Optional — undefined means "use llm defaults". The CLI ignores this; it's a Mission Control
  // convenience so the chosen profile persists across dashboard reloads without requiring a flag.
  activeProfile?: string;
  // Webhook configuration for external triggers. The token is a shared secret that must match
  // the URL path for POST /webhooks/:token/trigger/:name to fire a Captain or Job run.
  // webhookSecret is an optional HMAC-SHA256 signing secret: when set, the caller must include
  // X-Hub-Signature-256: sha256=<hex> computed over the raw request body using this secret.
  webhooks?: {
    token: string;
    webhookSecret?: string;
  };
  // Service configuration for peer discovery. peerUrl is the public URL of this ctxhub
  // instance, announced via heartbeat so other instances can discover it.
  service?: {
    peerUrl?: string;
  };
};

export type ExecutionProfile = {
  // Defaults the framing persona when a command's `--as <persona>` isn't separately given.
  persona?: string;
  // 'direct-api' (docs/control-plane.md Phase 7) skips harness CLIs entirely, calling `gateway`
  // instead -- for users who want direct model-provider access with no harness CLI installed.
  runtime: LlmAgentName | 'direct-api';
  // Only claude/codex are verified to accept a --model flag today (see src/llm/runAgent.ts);
  // set on copilot/cursor profiles is accepted but currently has no effect on the invocation.
  // Required (and the only thing that matters) when runtime is 'direct-api'.
  model?: string;
  tags?: string[];
  // Only used when runtime is 'direct-api'. One generic OpenAI-compatible shape covers OpenRouter,
  // LiteLLM, Portkey, Ollama, and enterprise proxies through a single baseUrl (src/gateway/openaiCompatible.ts).
  gateway?: {
    baseUrl: string;
    // Name of an environment variable holding the API key -- never the key itself in config.
    apiKeyEnv?: string;
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
  /** Trust tier for cross-org search filtering. Defaults to 'unverified' when absent. */
  trustTier?: import('../indexing/chunk.js').ChunkTrustTier;
  /** Set when a chunk's trust tier was manually elevated via `ctxhub chunk promote`. */
  promotedAt?: string;
  /** Who performed the manual promotion (e.g. 'cli', or a named operator via --by). */
  promotedBy?: string;
  /** Optional human-readable reason recorded at promotion time. */
  promotionReason?: string;
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
