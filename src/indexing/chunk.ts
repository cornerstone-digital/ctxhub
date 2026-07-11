import type { CtxhubConfig } from '../config/types.js';
import { runAgentPrompt } from '../llm/runAgent.js';
import { isSourceFile, topLevelSymbols, type SymbolKind } from '../context/symbols.js';

// ── Trust tiers ────────────────────────────────────────────────────────────────
// Ordered from least to most trusted. Used in cross-org search to filter results.
export type ChunkTrustTier = 'unverified' | 'reviewed' | 'promoted' | 'institutional' | 'canonical';

export const TRUST_TIER_ORDER: ChunkTrustTier[] = ['unverified', 'reviewed', 'promoted', 'institutional', 'canonical'];

/**
 * Returns true if the chunk's trustTier is at least as trusted as `min`.
 * Chunks without a trustTier are treated as 'unverified'.
 */
export function meetsMinTrustTier(chunk: { trustTier?: ChunkTrustTier }, min: ChunkTrustTier): boolean {
  const tier = chunk.trustTier ?? 'unverified';
  return TRUST_TIER_ORDER.indexOf(tier) >= TRUST_TIER_ORDER.indexOf(min);
}

export type TextChunk = {
  heading?: string;
  kind?: 'document' | 'architecture-diagram' | 'file-summary';
  diagramType?: string;
  components?: string[];
  relationships?: string[];
  symbol?: string;
  symbolKind?: SymbolKind;
  content: string;
};

const frontmatterPattern = /^---\n[\s\S]*?\n---\n?/;
const mermaidFencePattern = /```(?:mermaid|mmd)\s*\n([\s\S]*?)```/gi;
const LLM_FILE_SUMMARY_MIN_CHARS = 2000;

export function chunkText(content: string, maxChars: number): TextChunk[] {
  return chunkMarkdown(content, maxChars);
}

export function chunkDocument(filePath: string, content: string, maxChars: number): TextChunk[] {
  if (isMermaidFile(filePath)) {
    return [diagramChunk(content)];
  }

  if (isSourceFile(filePath)) {
    const sourceChunks = chunkSourceCode(content, maxChars);
    if (sourceChunks.length) return sourceChunks;
  }

  const chunks = chunkMarkdown(content, maxChars);
  const diagramChunks = extractMermaidBlocks(content).map(block => diagramChunk(block));
  return [...chunks, ...diagramChunks];
}

// One chunk per top-level function/class/arrow-function so search and open_chunk return
// whole symbols instead of arbitrary blank-line-delimited slices. Falls back to plain-text
// paragraph chunking (via chunkDocument's caller) when no recognizable symbols are found --
// e.g. type-only files, constants, or code the heuristic parser can't confidently match.
export function chunkSourceCode(content: string, maxChars: number): TextChunk[] {
  const symbols = topLevelSymbols(content).sort((a, b) => a.startLine - b.startLine);
  if (!symbols.length) return [];

  const lines = content.split('\n');
  const chunks: TextChunk[] = [];
  let cursor = 1;

  for (const symbol of symbols) {
    if (symbol.startLine > cursor) {
      const between = lines.slice(cursor - 1, symbol.startLine - 1).join('\n');
      if (between.trim()) chunks.push(...chunkPlainText(between, maxChars));
    }

    const symbolContent = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');
    for (const part of chunkPlainText(symbolContent, maxChars)) {
      chunks.push({ ...part, heading: symbol.name, symbol: symbol.name, symbolKind: symbol.kind });
    }

    cursor = symbol.endLine + 1;
  }

  if (cursor <= lines.length) {
    const trailing = lines.slice(cursor - 1).join('\n');
    if (trailing.trim()) chunks.push(...chunkPlainText(trailing, maxChars));
  }

  return chunks;
}

export function chunkMarkdown(content: string, maxChars: number): TextChunk[] {
  const frontmatter = content.match(frontmatterPattern)?.[0] ?? '';
  const body = frontmatter ? content.slice(frontmatter.length) : content;
  const sections = body.split(/(?=^#{1,6}\s+.+$)/m).filter(section => section.trim());

  if (!sections.length) {
    return chunkPlainText(content, maxChars);
  }

  return sections.flatMap(section => {
    const heading = section.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
    const sectionContent = `${frontmatter}${section}`.trim();
    return chunkPlainText(sectionContent, maxChars).map(chunk => ({ ...chunk, heading: heading ?? chunk.heading }));
  });
}

export function chunkPlainText(content: string, maxChars: number): TextChunk[] {
  const paragraphs = content.split(/\n{2,}/);
  const chunks: TextChunk[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current.trim()) chunks.push({ content: current.trim() });
    current = paragraph;
  }

  if (current.trim()) chunks.push({ content: current.trim() });
  return chunks;
}

export function extractTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

// A cheap, non-LLM orientation aid for files that chunk into several pieces: one extra chunk
// listing the file's title plus every sub-chunk heading -- section headings for docs, symbol
// names for source (chunkSourceCode already sets `heading` to the symbol name), so the same
// logic covers both without needing to special-case source vs. markdown. Skipped for
// single-chunk files, since the whole file is already as compact as the summary would be.
export function buildFileSummaryChunk(filePath: string, title: string | undefined, parts: TextChunk[]): TextChunk | undefined {
  if (parts.length <= 1) return undefined;

  const headings = [...new Set(parts.map(part => part.heading).filter((heading): heading is string => Boolean(heading)))];
  if (!headings.length) return undefined;

  const name = title ?? filePath;
  return {
    kind: 'file-summary',
    heading: `Summary: ${name}`,
    content: [`File summary: ${name}`, `Contains: ${headings.join(', ')}`].join('\n')
  };
}

export async function buildFileSummaryChunkWithLlm(
  filePath: string,
  title: string | undefined,
  parts: TextChunk[],
  fullContent: string,
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<TextChunk | undefined> {
  const fallback = buildFileSummaryChunk(filePath, title, parts);
  if (!fallback) return undefined;
  if (!config.llm.enabled || fullContent.length < LLM_FILE_SUMMARY_MIN_CHARS) return fallback;

  // Hard timeout on the LLM call so a hung agent CLI (waiting for auth, network, etc.)
  // never freezes the entire indexer. 30 s is generous for a summarisation prompt;
  // if it times out we fall back to the structural summary cleanly.
  // .unref() ensures this timer doesn't prevent the process from exiting if everything
  // else completes (important for tests and short-lived CLI invocations).
  const LLM_TIMEOUT_MS = 30_000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error('LLM summary timed out')), LLM_TIMEOUT_MS);
    timer.unref();
  });
  const result = await Promise.race([
    runAgentPromptFn(config, buildFileSummaryPrompt(filePath, title, parts, fullContent)),
    timeoutPromise
  ]).catch(() => ({ ok: false as const, text: '' }));
  if (!result.ok) return fallback;

  const summary = result.text.trim();
  if (!summary) return fallback;

  return {
    ...fallback,
    content: [`File summary: ${title ?? filePath}`, summary].join('\n')
  };
}

export function extractMermaidBlocks(content: string): string[] {
  return [...content.matchAll(mermaidFencePattern)].map(match => match[1]?.trim()).filter(Boolean) as string[];
}

export function detectDiagramType(content: string): string | undefined {
  const firstMeaningfulLine = content
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('%%'));
  return firstMeaningfulLine?.split(/\s+/)[0];
}

export function extractDiagramRelationships(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => /[-.=]+>|--|<->|->>/.test(line))
    .map(line => line.replace(/\s+/g, ' '))
    .slice(0, 100);
}

export function extractDiagramComponents(content: string): string[] {
  const components = new Set<string>();
  for (const relationship of extractDiagramRelationships(content)) {
    const cleaned = relationship.replace(/\|[^|]*\|/g, ' ').replace(/\[[^\]]*\]|\([^)]+\)|\{[^}]+\}/g, ' ');
    for (const token of cleaned.split(/[-.=<>:\s]+/)) {
      const normalized = token.replace(/[^A-Za-z0-9_./-]/g, '');
      if (/^[A-Za-z][A-Za-z0-9_./-]*$/.test(normalized) && !isMermaidKeyword(normalized)) {
        components.add(normalized);
      }
    }
  }

  return [...components].slice(0, 100);
}

function diagramChunk(content: string): TextChunk {
  const diagramType = detectDiagramType(content);
  const components = extractDiagramComponents(content);
  const relationships = extractDiagramRelationships(content);
  return {
    kind: 'architecture-diagram',
    heading: diagramType ? `Mermaid ${diagramType}` : 'Mermaid diagram',
    diagramType,
    components,
    relationships,
    content: [
      'architecture diagram mermaid',
      diagramType ? `type: ${diagramType}` : undefined,
      components.length ? `components: ${components.join(', ')}` : undefined,
      relationships.length ? `relationships: ${relationships.join('; ')}` : undefined,
      content.trim()
    ].filter(Boolean).join('\n')
  };
}

function isMermaidFile(filePath: string): boolean {
  return /\.(mmd|mermaid)$/i.test(filePath);
}

function isMermaidKeyword(value: string): boolean {
  return [
    'flowchart',
    'graph',
    'sequenceDiagram',
    'classDiagram',
    'erDiagram',
    'stateDiagram',
    'stateDiagram-v2',
    'C4Context',
    'C4Container',
    'C4Component',
    'participant',
    'actor',
    'as',
    'subgraph',
    'end'
  ].includes(value);
}

function buildFileSummaryPrompt(filePath: string, title: string | undefined, parts: TextChunk[], fullContent: string): string {
  const headings = [...new Set(parts.map(part => part.heading).filter((heading): heading is string => Boolean(heading)))];
  return [
    `Summarize this indexed file for fast orientation.`,
    `Path: ${filePath}`,
    title ? `Title: ${title}` : undefined,
    headings.length ? `Known sections/symbols: ${headings.join(', ')}` : undefined,
    '',
    'File content:',
    fullContent,
    '',
    'Write one short paragraph grounded only in the file content above. Do not invent capabilities or dependencies not present in the file.'
  ].filter(Boolean).join('\n');
}
