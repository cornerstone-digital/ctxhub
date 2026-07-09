import path from 'node:path';
import type { IndexedDocument, IndexProviderName, IndexStatus, SearchResult } from '../config/types.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { IndexProvider } from './IndexProvider.js';

type Store = { chunks: Record<string, IndexedDocument> };

export class LocalJsonIndex implements IndexProvider {
  readonly name = 'local-json';

  constructor(private readonly storePath: string) {}

  private async load(): Promise<Store> {
    if (!(await pathExists(this.storePath))) return { chunks: {} };
    return JSON.parse(await readText(this.storePath)) as Store;
  }

  private async save(store: Store): Promise<void> {
    await writeText(this.storePath, JSON.stringify(store, null, 2));
  }

  async indexDocuments(documents: IndexedDocument[]): Promise<void> {
    const store = await this.load();
    for (const document of documents) store.chunks[document.id] = document;
    await this.save(store);
  }

  async removeDocuments(documentIds: string[]): Promise<void> {
    const store = await this.load();
    for (const id of documentIds) delete store.chunks[id];
    await this.save(store);
  }

  async getDocument(documentId: string): Promise<IndexedDocument | undefined> {
    const store = await this.load();
    return store.chunks[documentId];
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const store = await this.load();
    return lexicalSearch(Object.values(store.chunks), query, limit);
  }

  async recent(limit = 20): Promise<IndexedDocument[]> {
    const store = await this.load();
    return Object.values(store.chunks)
      .sort((a, b) => b.lastIndexed.localeCompare(a.lastIndexed))
      .slice(0, limit);
  }

  async status(): Promise<IndexStatus> {
    const store = await this.load();
    const documents = Object.values(store.chunks);
    return {
      provider: this.name as IndexProviderName,
      documentCount: documents.length,
      chunkCount: documents.length,
      indexLocation: this.storePath,
      lastIndexed: documents.map(document => document.lastIndexed).sort().at(-1)
    };
  }

  async clear(): Promise<void> {
    await this.save({ chunks: {} });
  }
}

export function createSnippet(content: string, terms: string[]): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
  const firstMatch = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 120);
  const snippet = compact.slice(start, start + 360);
  return `${start > 0 ? '...' : ''}${snippet}${start + 360 < compact.length ? '...' : ''}`;
}

export function lexicalSearch(documents: IndexedDocument[], query: string, limit: number): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return documents
    .map(document => {
      const haystack = [
        document.kind,
        document.diagramType,
        document.repo,
        document.filePath,
        document.title,
        document.components?.join(' '),
        document.relationships?.join(' '),
        document.content
      ].filter(Boolean).join(' ').toLowerCase();
      const termScore = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
      const score = termScore ? termScore + searchBoost(document) : 0;
      return { ...document, score, snippet: createSnippet(document.content, terms) };
    })
    .filter(document => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function searchBoost(document: IndexedDocument): number {
  let boost = 0;
  if (document.kind === 'architecture-diagram') boost += 2;
  if (/README\.md$/i.test(document.filePath)) boost += 1.5;
  if (/(^|\/)(adr|docs)\//i.test(document.filePath)) boost += 1;
  if (/agent-notes\//i.test(document.filePath)) boost += 0.5;
  return boost;
}

export function createLocalJsonIndex(configuredPath: string, cwd = process.cwd()): IndexProvider {
  return new LocalJsonIndex(path.resolve(cwd, configuredPath));
}
