import { loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import type { IndexedDocument } from '../config/types.js';

export async function openCommand(id: string, opts: { json?: boolean } = {}) {
  const config = await loadConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const document = await resolveDocument(id, index);
  if (!document) throw new Error(`Chunk not found: ${id}`);

  if (opts.json) {
    console.log(JSON.stringify(document, null, 2));
    return;
  }

  console.log(`# ${document.repo}:${document.filePath}${document.title ? ` - ${document.title}` : ''}`);
  console.log('');
  console.log(document.content);
}

type OpenIndex = {
  getDocument(documentId: string): Promise<IndexedDocument | undefined>;
  recent(limit?: number): Promise<IndexedDocument[]>;
  name?: string;
};

async function resolveDocument(id: string, index: OpenIndex): Promise<IndexedDocument | undefined> {
  const exact = await index.getDocument(id);
  if (exact) return exact;

  if (id.length < 8) return undefined;
  const matches = (await index.recent(1000)).filter(document => document.id.startsWith(id));
  if (matches.length > 1) {
    throw new Error(`Chunk id prefix is ambiguous: ${id}. Matches: ${matches.map(match => match.id.slice(0, 12)).join(', ')}`);
  }
  return matches[0];
}
