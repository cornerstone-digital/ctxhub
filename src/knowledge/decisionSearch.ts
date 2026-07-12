import { loadWorkspaceConfig } from '../config/config.js';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadKnowledgeStore } from './store.js';

export interface DecisionSearchResult {
  type: 'knowledge_object' | 'indexed_chunk';
  id: string;
  title: string;
  content: string;           // snippet (first 300 chars)
  confidence?: number;       // KO only
  trustTier?: string;        // chunk only
  workspaceId: string;
  workspaceName?: string;
  updatedAt?: string;
  matchScore: number;        // simple keyword relevance 0–1
}

// Stop words stripped from the query before scoring
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'what', 'why', 'when', 'who', 'how', 'did', 'does',
]);

// Tokenise query into lowercase keywords, removing stop words
export function tokeniseQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

// Score a piece of text against the keyword set.
// titleHits get weight 3, bodyHits get weight 1.
function scoreText(title: string, body: string, keywords: string[]): number {
  if (!keywords.length) return 0;

  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();

  let hits = 0;
  for (const kw of keywords) {
    if (titleLower.includes(kw)) hits += 3;
    if (bodyLower.includes(kw)) hits += 1;
  }

  // Normalise: max possible per keyword is 4 (title + body), actual max is 4 * keywords.length
  const maxScore = 4 * keywords.length;
  return maxScore === 0 ? 0 : Math.min(hits / maxScore, 1);
}

// Paths that suggest decision-related content
const DECISION_PATH_PATTERNS = [/adr/i, /decision/i, /runbook/i, /architecture/i];

function isDecisionPath(filePath: string): boolean {
  return DECISION_PATH_PATTERNS.some(p => p.test(filePath));
}

export async function searchDecisions(
  query: string,
  options?: {
    workspaceId?: string;
    minConfidence?: number;
    includeArchived?: boolean;
    limit?: number;
  },
): Promise<DecisionSearchResult[]> {
  if (!query.trim()) return [];

  const keywords = tokeniseQuery(query);
  if (!keywords.length) return [];

  const limit = options?.limit ?? 10;
  const minConfidence = options?.minConfidence ?? 0;
  const includeArchived = options?.includeArchived ?? false;

  const results: DecisionSearchResult[] = [];

  // Determine which workspaces to search
  const workspaces = await listWorkspaces();
  const activeWorkspaces = workspaces.filter(ws => {
    if (!ws.exists) return false;
    if (options?.workspaceId) return ws.name === options.workspaceId;
    return true;
  });

  for (const ws of activeWorkspaces) {
    // ── Knowledge Objects ──────────────────────────────────────────────────
    const store = await loadKnowledgeStore(ws.name).catch(() => null);
    if (store) {
      for (const ko of store.objects) {
        if (!includeArchived && ko.state === 'archived') continue;
        if (ko.confidence < minConfidence) continue;

        const score = scoreText(ko.title, ko.content, keywords);
        if (score > 0) {
          results.push({
            type: 'knowledge_object',
            id: ko.id,
            title: ko.title,
            content: ko.content.slice(0, 300),
            confidence: ko.confidence,
            workspaceId: ws.name,
            workspaceName: ws.name,
            updatedAt: ko.updatedAt,
            matchScore: score,
          });
        }
      }
    }

    // ── Indexed chunks (institutional / canonical, decision paths) ────────
    try {
      const { config } = await loadWorkspaceConfig(ws.path);
      const { createIndexProvider } = await import('../indexing/providers.js');
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, ws.path);
      const docs = await index.recent(500).catch(() => []);

      for (const doc of docs) {
        const tier = doc.trustTier ?? 'unverified';
        if (tier !== 'institutional' && tier !== 'canonical') continue;
        if (!isDecisionPath(doc.filePath)) continue;

        const title = doc.title ?? doc.filePath;
        const score = scoreText(title, doc.content, keywords);
        if (score > 0) {
          results.push({
            type: 'indexed_chunk',
            id: doc.id,
            title,
            content: doc.content.slice(0, 300),
            trustTier: tier,
            workspaceId: ws.name,
            workspaceName: ws.name,
            matchScore: score,
          });
        }
      }
    } catch {
      // Index unavailable — skip silently
    }
  }

  // Sort by matchScore descending, return top limit
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results.slice(0, limit);
}

// ── Format helpers ─────────────────────────────────────────────────────────────

export function formatDecisionResults(results: DecisionSearchResult[]): string {
  if (!results.length) return 'No matching decisions found.';

  return results
    .map((r, i) => {
      const badge = r.type === 'knowledge_object'
        ? `[KO] ${r.title}  (confidence: ${(r.confidence ?? 0).toFixed(1)})`
        : `[ADR] ${r.title}  (${r.trustTier ?? 'unknown'})`;
      const snippet = r.content.replace(/\n/g, ' ').trim();
      const meta = [
        r.workspaceName ? `workspace: ${r.workspaceName}` : null,
        r.updatedAt ? `updated: ${r.updatedAt.slice(0, 10)}` : null,
      ].filter(Boolean).join('  •  ');
      return `${i + 1}. ${badge}\n   "${snippet}"\n   ${meta}`;
    })
    .join('\n\n');
}
