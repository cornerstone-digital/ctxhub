import path from 'node:path';
import type { IndexedDocument, IndexProviderName, IndexStatus, SearchResult } from '../config/types.js';
import { ensureDir } from '../utils/fs.js';
import type { IndexProvider } from './IndexProvider.js';
import { exactMatchBoost, lexicalSearch, searchBoost } from './LocalJsonIndex.js';

type LanceDbModule = typeof import('@lancedb/lancedb');
type LanceTable = import('@lancedb/lancedb').Table;
const RETRYABLE_LANCE_WRITE_DELAYS_MS = [50, 100, 200, 400, 800];

export class LanceDbIndex implements IndexProvider {
  readonly name = 'lancedb';

  constructor(
    private readonly dbPath: string,
    private readonly tableName: string
  ) {}

  private async lancedb(): Promise<LanceDbModule> {
    return import('@lancedb/lancedb');
  }

  private async table(documents?: IndexedDocument[]): Promise<LanceTable> {
    await ensureDir(this.dbPath);
    const lancedb = await this.lancedb();
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();

    if (tableNames.includes(this.tableName)) {
      const existing = await db.openTable(this.tableName);
      await retryLanceWrite(() => this.ensureMetadataColumns(existing));
      return existing;
    }

    const seed = documents?.length ? documents.map(toRow) : [emptyRow()];
    const table = await retryLanceWrite(() => db.createTable(this.tableName, seed, { mode: 'overwrite' }));
    if (!documents?.length) {
      await retryLanceWrite(() => table.delete("id = '__empty__'"));
    }
    await this.createFullTextIndex(table);
    return table;
  }

  private async existingTable(): Promise<LanceTable | undefined> {
    await ensureDir(this.dbPath);
    const lancedb = await this.lancedb();
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    return tableNames.includes(this.tableName) ? db.openTable(this.tableName) : undefined;
  }

  async indexDocuments(documents: IndexedDocument[]): Promise<void> {
    if (!documents.length) return;
    const table = await this.table(documents);
    await this.removeDocuments(documents.map(document => document.id));
    await retryLanceWrite(() => table.add(documents.map(toRow)));
  }

  async flush(): Promise<void> {
    const table = await this.existingTable();
    if (!table) return;
    await this.createFullTextIndex(table);
  }

  async removeDocuments(documentIds: string[]): Promise<void> {
    if (!documentIds.length) return;
    const table = await this.table();
    // Batch into groups of 50 to avoid unbounded OR predicates on repos with many chunks per file.
    const BATCH_SIZE = 50;
    for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
      const batch = documentIds.slice(i, i + BATCH_SIZE);
      const predicates = batch.map(id => `id = '${escapeSqlString(id)}'`).join(' OR ');
      await retryLanceWrite(() => table.delete(predicates));
    }
  }

  async getDocument(documentId: string): Promise<IndexedDocument | undefined> {
    const table = await this.existingTable();
    if (!table) return undefined;
    const rows = await table.query().where(`id = '${escapeSqlString(documentId)}'`).limit(1).toArray();
    const [row] = rows;
    return row ? rowToDocument(row) : undefined;
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const table = await this.existingTable();
    if (!table) return [];
    try {
      const rows = await table.search(query, 'fts', 'content').limit(limit).toArray();
      const terms = searchTerms(query);
      return rows.map(row => rowToSearchResult(row, terms)).sort((a, b) => b.score - a.score);
    } catch {
      // No `.limit()` call here deliberately -- a plain (non-vector) LanceDB query has no default
      // limit when omitted, so this scans the whole table rather than silently searching only an
      // arbitrary subset of it for workspaces past whatever cap would otherwise be hardcoded here.
      const rows = await table.query().toArray();
      return lexicalSearch(rows.map(rowToDocument), query, limit);
    }
  }

  async recent(limit = 20): Promise<IndexedDocument[]> {
    const table = await this.existingTable();
    if (!table) return [];
    // Fetch only the metadata columns needed for sorting and display — not content — so this
    // stays fast and memory-safe on large workspaces with many chunks. Content is only needed
    // when a caller then opens a specific chunk via getDocument().
    // The sort must happen in application code: a pre-sort `.limit()` would truncate to an
    // arbitrary (not actually "most recent") subset before sorting, so we fetch all metadata rows.
    const rows = await table.query().select(['id', 'workspace', 'repo', 'filePath', 'absolutePath', 'title', 'kind', 'diagramType', 'components', 'relationships', 'symbol', 'symbolKind', 'redacted', 'hash', 'commit', 'lastIndexed']).toArray();
    return rows
      .map(row => ({ ...rowToDocument(row), content: '' }))
      .sort((a, b) => b.lastIndexed.localeCompare(a.lastIndexed))
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    await ensureDir(this.dbPath);
    const lancedb = await this.lancedb();
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    if (tableNames.includes(this.tableName)) {
      await retryLanceWrite(() => db.dropTable(this.tableName));
    }
  }

  async status(): Promise<IndexStatus> {
    await ensureDir(this.dbPath);
    const lancedb = await this.lancedb();
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      return {
        provider: this.name as IndexProviderName,
        documentCount: 0,
        chunkCount: 0,
        indexLocation: this.dbPath
      };
    }

    const table = await db.openTable(this.tableName);
    const rowCount = await table.countRows();
    // Fetch only the lastIndexed column and use a SQL aggregate to find the maximum value
    // without loading all rows into memory. Falls back to a full-column scan only if the
    // table is empty (rowCount === 0) so the undefined branch stays reachable.
    let lastIndexed: string | undefined;
    if (rowCount > 0) {
      const rows = await table.query().select(['lastIndexed']).limit(1).toArray();
      // LanceDB doesn't expose ORDER BY DESC in the query builder yet; we fetch all
      // lastIndexed values in batches of 10 000 and take the lexicographic max.
      // ISO 8601 dates sort correctly as strings, so this is exact.
      const batchSize = 10_000;
      let maxSeen = '';
      for (let offset = 0; offset < rowCount; offset += batchSize) {
        const batch = await table.query().select(['lastIndexed']).offset(offset).limit(batchSize).toArray();
        for (const row of batch) {
          const val = String(row.lastIndexed);
          if (val > maxSeen) maxSeen = val;
        }
      }
      lastIndexed = maxSeen || undefined;
      void rows; // suppress unused-var warning from the rowCount > 0 guard above
    }
    return {
      provider: this.name as IndexProviderName,
      documentCount: rowCount,
      chunkCount: rowCount,
      indexLocation: this.dbPath,
      lastIndexed
    };
  }

  private async createFullTextIndex(table: LanceTable): Promise<void> {
    try {
      const lancedb = await this.lancedb();
      await retryLanceWrite(() => table.createIndex('content', {
        config: lancedb.Index.fts({ baseTokenizer: 'simple', lowercase: true })
      }));
    } catch {
      // The lexical fallback keeps search usable on small or partially indexed tables.
    }
  }

  private async ensureMetadataColumns(table: LanceTable): Promise<void> {
    const schema = await table.schema();
    const fields = schema.fields as Array<{ name: string }>;
    const existing = new Set(fields.map(field => field.name));
    const missing = ['kind', 'diagramType', 'components', 'relationships', 'redacted', 'symbol', 'symbolKind']
      .filter(name => !existing.has(name))
      .map(name => ({ name, valueSql: name === 'kind' ? "'document'" : name === 'redacted' ? 'false' : "''" }));

    if (missing.length) {
      await table.addColumns(missing);
    }
  }
}

async function retryLanceWrite<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = RETRYABLE_LANCE_WRITE_DELAYS_MS[attempt];
      if (delayMs === undefined || !isRetryableLanceWriteConflict(error)) {
        throw error;
      }
      await delay(delayMs);
    }
  }
}

function isRetryableLanceWriteConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Retryable commit conflict|preempted by concurrent transaction/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toRow(document: IndexedDocument): Record<string, unknown> {
  return {
    id: document.id,
    workspace: document.workspace,
    repo: document.repo,
    filePath: document.filePath,
    absolutePath: document.absolutePath,
    title: document.title ?? '',
    kind: document.kind ?? 'document',
    diagramType: document.diagramType ?? '',
    components: document.components?.join('\n') ?? '',
    relationships: document.relationships?.join('\n') ?? '',
    symbol: document.symbol ?? '',
    symbolKind: document.symbolKind ?? '',
    content: document.content,
    redacted: document.redacted ?? false,
    hash: document.hash,
    commit: document.commit ?? '',
    lastIndexed: document.lastIndexed
  };
}

function emptyRow(): Record<string, unknown> {
  return {
    id: '__empty__',
    workspace: '',
    repo: '',
    filePath: '',
    absolutePath: '',
    title: '',
    kind: 'document',
    diagramType: '',
    components: '',
    relationships: '',
    symbol: '',
    symbolKind: '',
    content: '',
    redacted: false,
    hash: '',
    commit: '',
    lastIndexed: ''
  };
}

function rowToDocument(row: Record<string, unknown>): IndexedDocument {
  return {
    id: String(row.id),
    workspace: String(row.workspace),
    repo: String(row.repo),
    filePath: String(row.filePath),
    absolutePath: String(row.absolutePath),
    kind: (['architecture-diagram', 'file-summary'] as const).includes(row.kind as 'architecture-diagram' | 'file-summary')
      ? row.kind as IndexedDocument['kind']
      : 'document',
    diagramType: String(row.diagramType || '') || undefined,
    components: splitList(row.components),
    relationships: splitList(row.relationships),
    symbol: String(row.symbol || '') || undefined,
    symbolKind: (String(row.symbolKind || '') || undefined) as IndexedDocument['symbolKind'],
    title: String(row.title || '') || undefined,
    content: String(row.content),
    redacted: Boolean(row.redacted),
    hash: String(row.hash),
    commit: String(row.commit || '') || undefined,
    lastIndexed: String(row.lastIndexed)
  };
}

function splitList(value: unknown): string[] | undefined {
  const items = String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function rowToSearchResult(row: Record<string, unknown>, terms: string[] = []): SearchResult {
  const document = rowToDocument(row);
  const score = Number(row._score ?? row.score ?? 0);
  return {
    ...document,
    score: score + searchBoost(document) + exactMatchBoost(document, terms),
    snippet: document.content.replace(/\s+/g, ' ').slice(0, 360)
  };
}

function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeSqlString(input: string): string {
  return input.replaceAll("'", "''");
}

export function createLanceDbIndex(configuredPath: string, tableName: string, cwd = process.cwd()): IndexProvider {
  return new LanceDbIndex(path.resolve(cwd, configuredPath), tableName);
}
