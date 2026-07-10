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
}
