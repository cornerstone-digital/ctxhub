import type { IndexedDocument, IndexStatus, SearchResult } from '../config/types.js';

export interface IndexProvider {
  name: string;
  indexDocuments(documents: IndexedDocument[]): Promise<void>;
  removeDocuments(documentIds: string[]): Promise<void>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  clear(): Promise<void>;
  status(): Promise<IndexStatus>;
}
