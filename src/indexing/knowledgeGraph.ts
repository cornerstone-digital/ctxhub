import type { CtxhubConfig, IndexedDocument } from '../config/types.js';
import { createIndexProvider } from './providers.js';
import { mapWithConcurrencyLimit } from '../utils/concurrency.js';

// An Obsidian-style graph, not a rigid hierarchy: one node per indexed file, edges are real
// relationships pulled from what's already indexed -- not a synthetic layout. Two sources:
//
//   1. Similarity edges -- for each file, search the index using the file's own content as the
//      query and link to whatever the index itself considers related. Reuses the exact same
//      search every other ctxhub command already relies on, rather than inventing a second
//      notion of "related."
//   2. Diagram edges -- explicit relationships parsed straight out of indexed Mermaid diagrams
//      (docs/architecture.md, etc.), which can introduce "component" nodes that aren't files at
//      all (a logical service named in a diagram with no 1:1 indexed file).
export type KnowledgeGraphNode = {
  id: string;
  label: string;
  repo: string;
  kind: 'file' | 'component';
  connections: number;
};

export type KnowledgeGraphEdge = {
  source: string;
  target: string;
  weight: number;
  kind: 'diagram' | 'similarity';
};

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  // True when there were more indexed files than MAX_FILE_NODES -- the graph still renders, just
  // not every file in a large workspace, same "directional signal, not exhaustive" tradeoff
  // `ctxhub stats` already documents for its own estimates.
  truncated: boolean;
};

const MAX_FILE_NODES = 120;
const SIMILARITY_NEIGHBORS = 4;
const SIMILARITY_CONCURRENCY = 8;

// Mirrors chunk.ts's extractDiagramComponents token-cleaning so a relationship line's first two
// real identifiers become the edge's (from, to) -- deliberately not re-parsing full Mermaid
// syntax, just enough to turn "A -->|label| B[Node label]" into { from: 'A', to: 'B' }.
function parseRelationshipLine(line: string): { from: string; to: string } | undefined {
  const cleaned = line.replace(/\|[^|]*\|/g, ' ').replace(/\[[^\]]*\]|\([^)]+\)|\{[^}]+\}/g, ' ');
  const tokens = cleaned
    .split(/[-.=<>:\s]+/)
    .map(token => token.replace(/[^A-Za-z0-9_./-]/g, ''))
    .filter(token => /^[A-Za-z][A-Za-z0-9_./-]*$/.test(token));
  if (tokens.length < 2) return undefined;
  return { from: tokens[0], to: tokens[1] };
}

function fileNodeId(doc: IndexedDocument): string {
  return `${doc.repo}:${doc.filePath}`;
}

export async function buildKnowledgeGraph(config: CtxhubConfig, workspaceRoot: string): Promise<KnowledgeGraph> {
  const provider = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const docs = await provider.recent(3000);

  // One entry per file, preferring its curated file-summary doc over a raw content chunk when
  // both exist for the same file.
  const byFile = new Map<string, IndexedDocument>();
  for (const doc of docs) {
    if (doc.kind === 'architecture-diagram') continue;
    const key = fileNodeId(doc);
    const existing = byFile.get(key);
    if (!existing || (doc.kind === 'file-summary' && existing.kind !== 'file-summary')) {
      byFile.set(key, doc);
    }
  }

  const allFiles = [...byFile.entries()];
  const truncated = allFiles.length > MAX_FILE_NODES;
  const fileEntries = allFiles.slice(0, MAX_FILE_NODES);

  const nodes: KnowledgeGraphNode[] = fileEntries.map(([key, doc]) => ({
    id: key,
    label: doc.filePath.split('/').pop() ?? doc.filePath,
    repo: doc.repo,
    kind: 'file',
    connections: 0
  }));
  const nodeIds = new Set(nodes.map(n => n.id));

  const edges: KnowledgeGraphEdge[] = [];
  const seenEdges = new Set<string>();
  function addEdge(source: string, target: string, weight: number, kind: 'diagram' | 'similarity'): void {
    if (source === target) return;
    const key = [source, target].sort().join('::');
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ source, target, weight, kind });
  }

  await mapWithConcurrencyLimit(fileEntries, SIMILARITY_CONCURRENCY, async ([key, doc]) => {
    const query = (doc.title ?? doc.content).slice(0, 300).trim();
    if (!query) return;
    const results = await provider.search(query, SIMILARITY_NEIGHBORS + 1).catch(() => []);
    for (const result of results) {
      const targetKey = fileNodeId(result);
      if (!nodeIds.has(targetKey)) continue;
      addEdge(key, targetKey, result.score, 'similarity');
    }
  });

  for (const doc of docs) {
    if (doc.kind !== 'architecture-diagram') continue;
    for (const line of doc.relationships ?? []) {
      const pair = parseRelationshipLine(line);
      if (!pair) continue;
      for (const id of [pair.from, pair.to]) {
        if (!nodeIds.has(id)) {
          nodeIds.add(id);
          nodes.push({ id, label: id, repo: doc.repo, kind: 'component', connections: 0 });
        }
      }
      addEdge(pair.from, pair.to, 1, 'diagram');
    }
  }

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) node.connections = degree.get(node.id) ?? 0;

  return { nodes, edges, truncated };
}
