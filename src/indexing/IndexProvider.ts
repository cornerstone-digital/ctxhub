import type { IndexedDocument, IndexStatus, SearchResult } from '../config/types.js';

export interface IndexProvider {
  name: string;
  indexDocuments(documents: IndexedDocument[]): Promise<void>;
  removeDocuments(documentIds: string[]): Promise<void>;
  getDocument(documentId: string): Promise<IndexedDocument | undefined>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  recent(limit?: number): Promise<IndexedDocument[]>;
  clear(): Promise<void>;
  status(): Promise<IndexStatus>;
  /** Called once after the entire indexing run completes; used to build expensive indexes (e.g. FTS) a single time rather than per batch. */
  flush?(): Promise<void>;
}
