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
  | { type: 'captain.handoff'; from: string; to: string; fromWorkspace: string; toWorkspace: string };

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
