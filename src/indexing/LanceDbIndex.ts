import path from 'node:path';
import type { IndexedDocument, IndexProviderName, IndexStatus, SearchResult } from '../config/types.js';
import { ensureDir } from '../utils/fs.js';
import type { IndexProvider } from './IndexProvider.js';
import { lexicalSearch, searchBoost } from './LocalJsonIndex.js';

type LanceDbModule = typeof import('@lancedb/lancedb');
type LanceTable = import('@lancedb/lancedb').Table;

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
      await this.ensureMetadataColumns(existing);
      return existing;
    }

    const seed = documents?.length ? documents.map(toRow) : [emptyRow()];
    const table = await db.createTable(this.tableName, seed, { mode: 'overwrite' });
    if (!documents?.length) {
      await table.delete("id = '__empty__'");
    }
    await this.createFullTextIndex(table);
    return table;
  }

  async indexDocuments(documents: IndexedDocument[]): Promise<void> {
    if (!documents.length) return;
    const table = await this.table(documents);
    await this.removeDocuments(documents.map(document => document.id));
    await table.add(documents.map(toRow));
    await this.createFullTextIndex(table);
  }

  async removeDocuments(documentIds: string[]): Promise<void> {
    if (!documentIds.length) return;
    const table = await this.table();
    const predicates = documentIds.map(id => `id = '${escapeSqlString(id)}'`).join(' OR ');
    await table.delete(predicates);
  }

  async getDocument(documentId: string): Promise<IndexedDocument | undefined> {
    const table = await this.table();
    const rows = await table.query().where(`id = '${escapeSqlString(documentId)}'`).limit(1).toArray();
    const [row] = rows;
    return row ? rowToDocument(row) : undefined;
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const table = await this.table();
    try {
      const rows = await table.search(query, 'fts', 'content').limit(limit).toArray();
      return rows.map(rowToSearchResult).sort((a, b) => b.score - a.score);
    } catch {
      const rows = await table.query().limit(10000).toArray();
      return lexicalSearch(rows.map(rowToDocument), query, limit);
    }
  }

  async recent(limit = 20): Promise<IndexedDocument[]> {
    const table = await this.table();
    const rows = await table.query().limit(10000).toArray();
    return rows
      .map(rowToDocument)
      .sort((a, b) => b.lastIndexed.localeCompare(a.lastIndexed))
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    await ensureDir(this.dbPath);
    const lancedb = await this.lancedb();
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    if (tableNames.includes(this.tableName)) {
      await db.dropTable(this.tableName);
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
    const rows = await table.query().select(['lastIndexed']).limit(10000).toArray();
    return {
      provider: this.name as IndexProviderName,
      documentCount: await table.countRows(),
      chunkCount: await table.countRows(),
      indexLocation: this.dbPath,
      lastIndexed: rows.map(row => String(row.lastIndexed)).sort().at(-1)
    };
  }

  private async createFullTextIndex(table: LanceTable): Promise<void> {
    try {
      const lancedb = await this.lancedb();
      await table.createIndex('content', {
        config: lancedb.Index.fts({ baseTokenizer: 'simple', lowercase: true })
      });
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
    kind: row.kind === 'architecture-diagram' ? 'architecture-diagram' : 'document',
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

function rowToSearchResult(row: Record<string, unknown>): SearchResult {
  const document = rowToDocument(row);
  const score = Number(row._score ?? row.score ?? 0);
  return {
    ...document,
    score: score + searchBoost(document),
    snippet: document.content.replace(/\s+/g, ' ').slice(0, 360)
  };
}

function escapeSqlString(input: string): string {
  return input.replaceAll("'", "''");
}

export function createLanceDbIndex(configuredPath: string, tableName: string, cwd = process.cwd()): IndexProvider {
  return new LanceDbIndex(path.resolve(cwd, configuredPath), tableName);
}
