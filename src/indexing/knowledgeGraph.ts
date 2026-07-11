import type { CtxhubConfig, IndexedDocument } from '../config/types.js';
import { createIndexProvider } from './providers.js';
import { mapWithConcurrencyLimit } from '../utils/concurrency.js';
import { readText } from '../utils/fs.js';
import { redactContent } from './redact.js';
import type { IndexProvider } from './IndexProvider.js';

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
  // True when there were more indexed files than MAX_SIMILARITY_NODES -- every file still becomes
  // a node (Obsidian-style: no cap on what's shown, d3's canvas rendering handles a few thousand
  // nodes fine), but files beyond the budget only carry diagram edges, not similarity edges, since
  // computing those needs a real index search per file. "Truncated" now describes edge coverage,
  // not node visibility.
  truncated: boolean;
};

const MAX_SIMILARITY_NODES = 120;
const SIMILARITY_NEIGHBORS = 4;
const SIMILARITY_CONCURRENCY = 8;
// How many recently-indexed chunks to scan when deriving the file list. Was 3000 chunks, quietly
// tight enough that ctxhub's own workspace (2211 chunks across 259 files) was already within
// range of hitting it -- past that, files stop appearing as graph nodes at all, not just missing
// similarity edges, which would have quietly broken the "every file is a node" guarantee this
// module makes elsewhere. Now safe to raise generously: LanceDbIndex.recent() no longer caps its
// own underlying fetch before sorting, so this number only bounds memory/time here, not
// correctness.
const MAX_INDEXED_DOCS_SCANNED = 20_000;

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

// One entry per file, preferring its curated file-summary doc over a raw content chunk when both
// exist for the same file -- shared by buildKnowledgeGraph (deciding which files become nodes)
// and findKnowledgeGraphNodeContent (looking up what to show when a node is clicked), so the two
// never disagree about which document represents a given file.
function indexFilesByNodeId(docs: IndexedDocument[]): Map<string, IndexedDocument> {
  const byFile = new Map<string, IndexedDocument>();
  for (const doc of docs) {
    if (doc.kind === 'architecture-diagram') continue;
    const key = fileNodeId(doc);
    const existing = byFile.get(key);
    if (!existing || (doc.kind === 'file-summary' && existing.kind !== 'file-summary')) {
      byFile.set(key, doc);
    }
  }
  return byFile;
}

function getProvider(config: CtxhubConfig, workspaceRoot: string): IndexProvider {
  return createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
}

// Shared by the bulk build (one call per file, budget-limited) and expandKnowledgeGraphNode (one
// call for a single node, invoked on demand) so there's exactly one definition of "how a file's
// similarity edges are computed" -- never two implementations to keep in sync.
async function similarityMatchesForFile(
  provider: IndexProvider,
  key: string,
  doc: IndexedDocument,
  nodeIds: Set<string>
): Promise<Array<{ target: string; weight: number }>> {
  const query = (doc.title ?? doc.content).slice(0, 300).trim();
  if (!query) return [];
  const results = await provider.search(query, SIMILARITY_NEIGHBORS + 1).catch(() => []);
  const matches: Array<{ target: string; weight: number }> = [];
  for (const result of results) {
    const targetKey = fileNodeId(result);
    if (targetKey === key || !nodeIds.has(targetKey)) continue;
    matches.push({ target: targetKey, weight: result.score });
  }
  return matches;
}

export async function buildKnowledgeGraph(config: CtxhubConfig, workspaceRoot: string): Promise<KnowledgeGraph> {
  const provider = getProvider(config, workspaceRoot);
  const docs = await provider.recent(MAX_INDEXED_DOCS_SCANNED);
  const byFile = indexFilesByNodeId(docs);

  const allFiles = [...byFile.entries()];
  const truncated = allFiles.length > MAX_SIMILARITY_NODES;
  // `provider.recent()` returns most-recently-indexed first, so this budget naturally favors
  // fresher files over stale ones when a workspace has more files than the similarity-search
  // budget covers -- not an arbitrary cutoff.
  const similarityEntries = allFiles.slice(0, MAX_SIMILARITY_NODES);

  const nodes: KnowledgeGraphNode[] = allFiles.map(([key, doc]) => ({
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

  await mapWithConcurrencyLimit(similarityEntries, SIMILARITY_CONCURRENCY, async ([key, doc]) => {
    const matches = await similarityMatchesForFile(provider, key, doc, nodeIds);
    for (const match of matches) addEdge(key, match.target, match.weight, 'similarity');
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

// On-demand counterpart to the bulk similarity-edge pass above: lets the UI "expand" a single node
// that missed the MAX_SIMILARITY_NODES budget (or just re-check a node's neighbors) with one real
// index search, rather than the whole-workspace 120x-search cost -- cheap enough to run on every
// node click. Every file is already a node by the time this runs (buildKnowledgeGraph has no
// display cap), so this only ever needs to return new edges, never new nodes.
export async function expandKnowledgeGraphNode(
  config: CtxhubConfig,
  workspaceRoot: string,
  nodeId: string
): Promise<KnowledgeGraphEdge[] | undefined> {
  const provider = getProvider(config, workspaceRoot);
  const docs = await provider.recent(MAX_INDEXED_DOCS_SCANNED);
  const byFile = indexFilesByNodeId(docs);
  const doc = byFile.get(nodeId);
  if (!doc) return undefined;

  const nodeIds = new Set(byFile.keys());
  const matches = await similarityMatchesForFile(provider, nodeId, doc, nodeIds);
  return matches.map(match => ({ source: nodeId, target: match.target, weight: match.weight, kind: 'similarity' as const }));
}

export type KnowledgeNodeContent =
  | {
      kind: 'file';
      id: string;
      repo: string;
      filePath: string;
      title?: string;
      // The curated file-summary text, when the index has one -- shown alongside the real
      // content below, not instead of it.
      summary?: string;
      content: string;
      // 'disk' is the common case: the real current file, redacted the same way indexing would
      // redact it. Falls back to 'index' (whatever chunk the index has, possibly itself a
      // summary rather than real content) only if the file is no longer readable at its indexed
      // path -- moved or deleted since the last index run.
      contentSource: 'disk' | 'index';
      truncated: boolean;
      lastIndexed: string;
    }
  | { kind: 'component'; id: string; diagrams: Array<{ repo: string; filePath: string; content: string }> };

const MAX_PREVIEW_CHARS = 200_000;

// Backs the graph's click-to-preview: same node-id scheme as buildKnowledgeGraph (`repo:filePath`
// for files, the bare component name for diagram-derived nodes), so a node id straight from a
// GET .../knowledge-graph response resolves here without any translation.
export async function findKnowledgeGraphNodeContent(
  config: CtxhubConfig,
  workspaceRoot: string,
  nodeId: string
): Promise<KnowledgeNodeContent | undefined> {
  const provider = getProvider(config, workspaceRoot);
  const docs = await provider.recent(MAX_INDEXED_DOCS_SCANNED);

  const fileDoc = indexFilesByNodeId(docs).get(nodeId);
  if (fileDoc) {
    const summary = fileDoc.kind === 'file-summary' ? fileDoc.content : undefined;

    let content = fileDoc.content;
    let contentSource: 'disk' | 'index' = 'index';
    let truncated = false;
    try {
      const raw = await readText(fileDoc.absolutePath);
      const redaction = redactContent(raw, config.privacy.redactPatterns);
      truncated = redaction.content.length > MAX_PREVIEW_CHARS;
      content = truncated ? redaction.content.slice(0, MAX_PREVIEW_CHARS) : redaction.content;
      contentSource = 'disk';
    } catch {
      // File no longer readable at its indexed path (moved/deleted since indexing) -- fall back
      // to whatever the index has rather than failing the whole preview.
    }

    return {
      kind: 'file',
      id: nodeId,
      repo: fileDoc.repo,
      filePath: fileDoc.filePath,
      title: fileDoc.title,
      summary,
      content,
      contentSource,
      truncated,
      lastIndexed: fileDoc.lastIndexed
    };
  }

  const diagrams = docs
    .filter(doc => doc.kind === 'architecture-diagram' && (doc.components ?? []).includes(nodeId))
    .map(doc => ({ repo: doc.repo, filePath: doc.filePath, content: doc.content }));
  if (diagrams.length > 0) {
    return { kind: 'component', id: nodeId, diagrams };
  }

  return undefined;
}
