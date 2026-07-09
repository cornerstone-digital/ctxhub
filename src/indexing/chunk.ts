export type TextChunk = {
  heading?: string;
  kind?: 'document' | 'architecture-diagram';
  diagramType?: string;
  components?: string[];
  relationships?: string[];
  content: string;
};

const frontmatterPattern = /^---\n[\s\S]*?\n---\n?/;
const mermaidFencePattern = /```(?:mermaid|mmd)\s*\n([\s\S]*?)```/gi;

export function chunkText(content: string, maxChars: number): TextChunk[] {
  return chunkMarkdown(content, maxChars);
}

export function chunkDocument(filePath: string, content: string, maxChars: number): TextChunk[] {
  if (isMermaidFile(filePath)) {
    return [diagramChunk(content)];
  }

  const chunks = chunkMarkdown(content, maxChars);
  const diagramChunks = extractMermaidBlocks(content).map(block => diagramChunk(block));
  return [...chunks, ...diagramChunks];
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
