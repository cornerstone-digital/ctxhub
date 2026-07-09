export type TextChunk = {
  heading?: string;
  content: string;
};

const frontmatterPattern = /^---\n[\s\S]*?\n---\n?/;

export function chunkText(content: string, maxChars: number): TextChunk[] {
  return chunkMarkdown(content, maxChars);
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
