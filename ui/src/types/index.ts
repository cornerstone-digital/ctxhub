export interface Workspace {
  name: string;
  path: string;
  exists: boolean;
  addedAt: string;
}

export interface CheckLine {
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface WorkspaceStatus {
  name: string;
  path: string;
  checks: CheckLine[];
}

export interface IndexResult {
  scanned: number;
  indexed: number;
  skipped: number;
  deleted: number;
}

export interface IndexJobState {
  status: 'idle' | 'running' | 'done' | 'error';
  repo?: string;
  scanned: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  result?: IndexResult;
  error?: string;
}

// Mirrors src/events/eventBus.ts's CtxhubEvent -- kept as a hand-written twin rather than a
// shared package since this is the only place the UI crosses that boundary; if the event
// catalog grows much further this should probably become a generated/shared type instead.
export type CtxhubEvent =
  | { type: 'index.started'; workspace: string }
  | { type: 'index.progress'; workspace: string; repo: string; scanned: number; total: number }
  | { type: 'index.completed'; workspace: string; result: IndexResult }
  | { type: 'index.failed'; workspace: string; error: string }
  | { type: 'captain.run.started'; task: string; workspace: string }
  | { type: 'captain.run.completed'; task: string; workspace: string; runId: string }
  | { type: 'captain.run.failed'; task: string; workspace: string; error: string }
  | { type: 'captain.run.promoted'; task: string; workspace: string; runId: string; notePath: string }
  | { type: 'captain.handoff'; from: string; to: string; fromWorkspace: string; toWorkspace: string }
  | { type: 'skills.installed'; workspace: string; agents: string[] }
  | { type: 'personas.synced'; workspace: string; agents: string[] }
  | { type: 'job.queued';         jobId: string; job: string }
  | { type: 'job.started';        jobId: string; job: string }
  | { type: 'job.step.started';   jobId: string; job: string; step: string; stepIndex: number }
  | { type: 'job.step.completed'; jobId: string; job: string; step: string; stepIndex: number }
  | { type: 'job.step.failed';    jobId: string; job: string; step: string; stepIndex: number; error: string }
  | { type: 'job.completed';      jobId: string; job: string }
  | { type: 'job.failed';         jobId: string; job: string; error: string };

export type CtxhubEventEnvelope = CtxhubEvent & { id: string; at: string };

// A little bot rendered on the Mission Control graph, one per in-flight index job / Captain run.
// Purely a UI-side projection of eventBus activity (see useEventStream) -- nothing server-side
// tracks "agents" as a concept, this is just what makes that activity visible and legible.
export interface AgentToken {
  id: string;
  kind: 'index' | 'captain';
  label: string;
  workspaceId: string;
  // Present only for a 'traveling' token -- the handoff's destination workspace, animated
  // between workspaceId (from) and toWorkspaceId (to).
  toWorkspaceId?: string;
  state: 'working' | 'traveling' | 'done' | 'error';
  percent?: number;
  spawnedAt: number;
}

export interface CaptainTask {
  name: string;
  workspace: string;
  query: string;
  persona?: string;
  profile?: string;
  schedule?: { everyMinutes: number };
  handoffTo?: string;
}

export interface CaptainRunRecord {
  runId: string;
  task: string;
  workspace: string;
  startedAt: string;
  // ExplainResult is declared further down in this file -- fine for TS type references
  // regardless of declaration order within a module.
  result: ExplainResult;
  handoffFrom?: string;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  repo: string;
  kind: 'file' | 'component';
  connections: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  weight: number;
  kind: 'diagram' | 'similarity';
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

export type KnowledgeNodeContent =
  | {
      kind: 'file';
      id: string;
      repo: string;
      filePath: string;
      title?: string;
      summary?: string;
      content: string;
      contentSource: 'disk' | 'index';
      truncated: boolean;
      lastIndexed: string;
    }
  | { kind: 'component'; id: string; diagrams: Array<{ repo: string; filePath: string; content: string }> };

export interface ExplainResult {
  query: string;
  workspace: string;
  generatedAt: string;
  answer: string[];
  evidence: unknown[];
  citations: Array<{ ref: string; repo: string; path: string; title?: string }>;
  freshness: unknown;
  llmNotice?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: ExplainResult['citations'];
  timestamp: Date;
  // The workspace this message was actually asked against -- kept on the message itself, not
  // read from the currently-selected chat workspace, so a citation click still jumps to the right
  // Knowledge graph even if the user has since switched workspaces in the selector.
  workspace: string;
}

export interface RepoConfig {
  name: string;
  path: string;
  include?: string[];
  exclude?: string[];
  git?: boolean;
}

export type LlmAgentName = 'claude' | 'codex' | 'copilot' | 'cursor';

export interface ExecutionProfile {
  persona?: string;
  runtime: LlmAgentName | 'direct-api';
  model?: string;
  tags?: string[];
  gateway?: { baseUrl: string; apiKeyEnv?: string };
}

// Mirrors config/types.ts's CtxhubConfig -- everything the workspace's ctxhub.yaml holds, as
// returned by GET /workspaces/:name/config.
export interface CtxhubConfig {
  version: number;
  workspace: { name: string };
  repositories: RepoConfig[];
  knowledge: { include: string[]; exclude: string[] };
  memory: { provider: 'local-json' | 'mempalace'; path: string };
  index: { provider: 'local-json' | 'lancedb'; path: string; table: string; incremental: boolean; chunkSize: number; concurrency?: number };
  hooks: { postPull?: string; postIndex?: string };
  privacy: { redactPatterns: string[] };
  llm: { enabled: boolean; agent?: LlmAgentName; timeoutMs: number };
  executionProfiles: Record<string, ExecutionProfile>;
}

export interface SkillStatus {
  agent: LlmAgentName;
  id: string;
  label?: string;
  installed: boolean;
  path: string;
}

export interface PersonasStatus {
  personas: Array<{ name: string; description?: string }>;
  policies: string[];
  compiledFor: LlmAgentName[];
}

export interface ReviewerProfile {
  name: string;
  kind: 'contract' | 'docs' | 'generic';
  focus?: string;
  persona?: string;
}

export interface ReviewResult {
  topic: string;
  persona: string;
  changed: Record<string, string[]>;
  contextPack: {
    suggestedReadingOrder: Array<{ repo: string; filePath: string; title?: string }>;
  };
  findings: string[];
  llmNotice?: string;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export interface JobStep {
  name: string;
  workspace: string;
  query: string;
  persona?: string;
  profile?: string;
  captainTask?: string;
}

export interface JobDefinition {
  name: string;
  description?: string;
  steps: JobStep[];
  schedule?: { everyMinutes: number };
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type JobStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobStepRun {
  stepName: string;
  status: JobStepStatus;
  startedAt?: string;
  completedAt?: string;
  input?: string;
  result?: {
    answer: string[];
    citations: Array<{ ref: string; repo: string; path: string; title?: string }>;
    llmNotice?: string;
  };
  error?: string;
}

export interface JobRun {
  jobId: string;
  job: string;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  steps: JobStepRun[];
}

// ── Eval types (mirrored from src/commands/eval.ts) ──────────────────────────

export interface EvalExpected {
  repo?: string;
  path?: string;
}

export interface EvalExpectedResult extends EvalExpected {
  rank?: number;
  score?: number;
  matchedPath?: string;
  matchedRepo?: string;
}

export interface EvalCaseResult {
  query: string;
  rationale?: string;
  passed: boolean;
  expected: EvalExpectedResult[];
  missing: EvalExpected[];
  topResults: Array<{ repo: string; path: string; title?: string; score: number }>;
}

export interface EvalRunResult {
  generatedAt: string;
  suitePath: string;
  summary: { total: number; passed: number; failed: number };
  cases: EvalCaseResult[];
}

export interface ActivityEvent {
  id: string;
  text: string;
  type: 'ok' | 'warn' | 'error' | 'info';
  timestamp: Date;
  // Present when this row was produced by a real eventBus event (vs. a local UI interaction
  // like "manual refresh clicked") -- the Event Log's detail panel needs the untouched envelope
  // to show full metadata, not just the human-readable summary text.
  raw?: CtxhubEventEnvelope;
}

// ── Corporate Groups ─────────────────────────────────────────────────────────

export type SharingMode = 'none' | 'read' | 'bidirectional';
export type TrustTier = 'observer' | 'participant' | 'trusted';

export interface CorporateGroup {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
}

export interface GroupOrg {
  id: string;
  groupId: string;
  name: string;
  tenantId: string;
  trustTier: TrustTier;
  peerUrl?: string;
  lastSeen?: string;
  registeredAt?: string;
  addedAt: string;
  addedBy: string;
}

export interface SharingPolicy {
  fromOrgId: string;
  toOrgId: string;
  mode: SharingMode;
  updatedAt: string;
  updatedBy: string;
}

export interface GroupListResponse {
  groups: CorporateGroup[];
  orgs: GroupOrg[];
  sharingPolicies: SharingPolicy[];
}

// ── Cloud ─────────────────────────────────────────────────────────────────────

export interface CloudStatus {
  configured: boolean;
  endpoint?: string;
  lastSyncAt?: string | null;
  chunksSynced?: number;
  chunksAvailable?: number;
}

export interface CloudCaptainRun {
  id: string;
  orgId: string;
  workspaceId: string;
  taskName: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  findingsCount: number;
  promotedCount: number;
  syncedAt: string;
}

export interface CloudNote {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  content: string;
  promotedAt: string;
  promotedBy: string;
  trustTier: string;
  syncedAt: string;
}

export interface CloudHistory {
  runs: CloudCaptainRun[];
  notes: CloudNote[];
  source: 'cloud' | 'local';
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export type Permission =
  | 'knowledge:read' | 'knowledge:write' | 'knowledge:promote'
  | 'workspace:read' | 'workspace:write'
  | 'group:read' | 'group:write'
  | 'audit:read'
  | 'admin:all';

export interface CustomRole {
  name: string;
  description?: string;
  permissions: Permission[];
  inheritsFrom?: string;
  createdAt: string;
  createdBy: string;
}

export interface RolesResponse {
  builtIn: readonly string[];
  custom: CustomRole[];
}

export interface WorkspaceMember {
  sub: string;
  role: string;
}

export interface WorkspaceMembersResponse {
  allowedRoles: string[];
  members: WorkspaceMember[];
}

// ── Blueprint Hub ─────────────────────────────────────────────────────────────

export interface BlueprintRecord {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  orgId: string | null;
  publishedBy: string;
  publishedAt: string;
  archiveHash: string;
  archiveSize: number;
  serviceTypes?: string[];
}

export interface BlueprintHubListResponse {
  blueprints: BlueprintRecord[];
  configured: boolean;
}

export interface BlueprintInstallResult {
  installed: { name: string; version: string; installedAt: string; path: string };
  depOrder: string[];
}

// ── Org Graph — cross-workspace Knowledge (M7) ─────────────────────────────────

export type KnowledgeObjectState = 'draft' | 'active' | 'superseded' | 'archived';

export interface CloudKnowledgeObject {
  id: string;
  orgId: string;
  workspaceId: string;
  localId: string;
  promotedBy: string;
  promotedAt: string;
  title: string;
  body: string;
  query?: string;
  agent?: string;
  state: KnowledgeObjectState;
  supersededBy?: string;
  archivedAt?: string;
  archiveReason?: string;
  confidence: number;
  corroborations: number;
  reviewFlag: boolean;
  conceptIds: string[];
  syncedAt: string;
}

export interface CloudKnowledgeEdge {
  id: string;
  orgId: string;
  fromId: string;
  toId: string;
  edgeType: 'superseded_by' | 'related_to' | 'contradicts';
  createdBy: string;
  createdAt: string;
}

export interface OrgKnowledgeQueryResponse {
  objects: CloudKnowledgeObject[];
  count: number;
  configured: boolean;
}

export interface OrgKnowledgeObjectResponse {
  object: CloudKnowledgeObject;
  edges: CloudKnowledgeEdge[];
}

// ── Usage stats ─────────────────────────────────────────────────────────────

export interface ToolUsage {
  calls: number;
  tokensReturned: number;
  tokensBaseline: number;
}

export interface ToolUsageSummary extends ToolUsage {
  tool: string;
  tokensSaved: number;
}

export interface DailyUsage extends ToolUsage {
  date: string;
  tokensSaved: number;
}

export interface UsageSummary {
  since?: string;
  lastUpdated?: string;
  totalCalls: number;
  tokensReturned: number;
  tokensBaseline: number;
  tokensSaved: number;
  savingsPercent: number;
  tools: ToolUsageSummary[];
  daily: DailyUsage[];
}
