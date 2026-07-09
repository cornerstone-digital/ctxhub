import type { IndexedDocument, MemoryStatus, SearchResult } from '../config/types.js';

export interface MemoryProvider {
  name: string;
  indexDocument(document: IndexedDocument): Promise<void>;
  removeDocument(documentId: string): Promise<void>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  clear(): Promise<void>;
  status(): Promise<MemoryStatus>;
}

export interface ChunkMemoryProvider extends MemoryProvider {
  indexDocuments(documents: IndexedDocument[]): Promise<void>;
  removeDocuments(documentIds: string[]): Promise<void>;
}

export interface MemoryAdapter extends ChunkMemoryProvider {
  upsertChunks(chunks: IndexedDocument[]): Promise<void>;
  deleteChunks(chunkIds: string[]): Promise<void>;
  stats(): Promise<{ chunks: number; lastIndexed?: string }>;
  clear(): Promise<void>;
}
