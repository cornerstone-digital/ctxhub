import path from 'node:path';
import type { IndexedDocument, MemoryProviderName, MemoryStatus, SearchResult } from '../config/types.js';
import type { MemoryAdapter } from './MemoryAdapter.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import { execa } from '../utils/execa-lite.js';

type Store = { chunks: Record<string, IndexedDocument> };

export class LocalJsonMemory implements MemoryAdapter {
  readonly name = 'local-json';

  constructor(private readonly storePath: string) {}

  private async load(): Promise<Store> {
    if (!(await pathExists(this.storePath))) return { chunks: {} };
    return JSON.parse(await readText(this.storePath)) as Store;
  }

  private async save(store: Store): Promise<void> {
    await writeText(this.storePath, JSON.stringify(store, null, 2));
  }

  async indexDocument(document: IndexedDocument): Promise<void> {
    await this.upsertChunks([document]);
  }

  async indexDocuments(documents: IndexedDocument[]): Promise<void> {
    await this.upsertChunks(documents);
  }

  async upsertChunks(chunks: IndexedDocument[]): Promise<void> {
    const store = await this.load();
    for (const chunk of chunks) store.chunks[chunk.id] = chunk;
    await this.save(store);
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.deleteChunks([documentId]);
  }

  async removeDocuments(documentIds: string[]): Promise<void> {
    await this.deleteChunks(documentIds);
  }

  async deleteChunks(chunkIds: string[]): Promise<void> {
    const store = await this.load();
    for (const id of chunkIds) delete store.chunks[id];
    await this.save(store);
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const store = await this.load();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    return Object.values(store.chunks)
      .map(chunk => {
        const haystack = `${chunk.repo} ${chunk.filePath} ${chunk.title ?? ''} ${chunk.content}`.toLowerCase();
        const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
        return { chunk, score, snippet: createSnippet(chunk.content, terms) };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({ ...item.chunk, score: item.score, snippet: item.snippet }));
  }

  async stats(): Promise<{ chunks: number; lastIndexed?: string }> {
    const store = await this.load();
    const lastIndexed = Object.values(store.chunks)
      .map(chunk => chunk.lastIndexed)
      .filter(Boolean)
      .sort()
      .at(-1);

    return { chunks: Object.keys(store.chunks).length, lastIndexed };
  }

  async status(): Promise<MemoryStatus> {
    const stats = await this.stats();
    return {
      provider: this.name as MemoryProviderName,
      documentCount: stats.chunks,
      chunkCount: stats.chunks,
      indexLocation: this.storePath,
      lastIndexed: stats.lastIndexed
    };
  }

  async clear(): Promise<void> {
    await this.save({ chunks: {} });
  }
}

export class MempalaceMemory implements MemoryAdapter {
  readonly name = 'mempalace';

  constructor(private readonly palacePath: string) {}

  async indexDocument(): Promise<void> {
    throw new Error('MemPalace writes should happen through its CLI/MCP tools, not the devctx document indexer.');
  }

  async indexDocuments(): Promise<void> {
    throw new Error('MemPalace writes should happen through its CLI/MCP tools, not the devctx document indexer.');
  }

  async upsertChunks(): Promise<void> {
    throw new Error('MemPalace writes should happen through its CLI/MCP tools, not the devctx document indexer.');
  }

  async removeDocument(): Promise<void> {
    throw new Error('MemPalace memory removal should happen through MemPalace itself.');
  }

  async removeDocuments(): Promise<void> {
    throw new Error('MemPalace memory removal should happen through MemPalace itself.');
  }

  async deleteChunks(): Promise<void> {
    throw new Error('MemPalace memory removal should happen through MemPalace itself.');
  }

  async search(): Promise<SearchResult[]> {
    throw new Error('Use MemPalace MCP/CLI search for durable agent memory. Use `devctx search` for the LanceDB project index.');
  }

  async stats(): Promise<{ chunks: number; lastIndexed?: string }> {
    return { chunks: 0 };
  }

  async status(): Promise<MemoryStatus> {
    const available = await isMempalaceAvailable();
    return {
      provider: this.name as MemoryProviderName,
      documentCount: 0,
      chunkCount: 0,
      indexLocation: available
        ? `${this.palacePath} (MemPalace CLI detected)`
        : `${this.palacePath} (MemPalace CLI not found; install with: uv tool install mempalace)`
    };
  }

  async clear(): Promise<void> {
    // Keep devctx clear non-destructive for external MemPalace stores.
  }
}

function createSnippet(content: string, terms: string[]): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
  const firstMatch = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 120);
  const snippet = compact.slice(start, start + 360);
  return `${start > 0 ? '...' : ''}${snippet}${start + 360 < compact.length ? '...' : ''}`;
}

export function createMemoryAdapter(provider: string, configuredPath: string, cwd = process.cwd()): MemoryAdapter {
  if (provider === 'local-json') {
    return new LocalJsonMemory(path.resolve(cwd, configuredPath));
  }

  if (provider === 'mempalace') {
    return new MempalaceMemory(path.resolve(cwd, configuredPath));
  }

  throw new Error(`Unsupported memory provider: ${provider}`);
}

async function isMempalaceAvailable(): Promise<boolean> {
  try {
    await execa('mempalace', ['--help']);
    return true;
  } catch {
    return false;
  }
}
