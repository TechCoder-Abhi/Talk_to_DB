import { Logger } from '@nestjs/common';
import { MongoClient, Db, Sort } from 'mongodb';
import { DbConnection, DbConnectionConfig, QueryExecution, TableInfo, ColumnInfo } from './connection.interface';

export class MongoDbConnection extends DbConnection {
  private readonly logger = new Logger(`MongoDbConnection:${this.id}`);
  private client?: MongoClient;
  private db?: Db;

  async connect(): Promise<void> {
    this.client = new MongoClient(this.url);
    try {
      await this.client.connect();
      const dbName = this.getDatabaseName();
      this.db = this.client.db(dbName);
      await this.db.command({ ping: 1 });
      this.logger.log(`Connection established to database '${dbName}'`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Connection failed: ${message}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
  }

  getQueryLanguage(): 'mongodb' {
    return 'mongodb';
  }

  async executeQuery(query: string): Promise<QueryExecution> {
    const startedAt = Date.now();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return {
        query: trimmedQuery,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: Date.now() - startedAt,
        error: 'MongoDB query is empty.',
        limited: false,
      };
    }

    let parsed: { collection: string; type: 'find' | 'aggregate'; pipeline?: Record<string, unknown>[]; filter?: Record<string, unknown>; projection?: Record<string, unknown>; sort?: Record<string, unknown>; limit?: number };
    try {
      parsed = JSON.parse(trimmedQuery);
    } catch {
      return {
        query: trimmedQuery,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: Date.now() - startedAt,
        error: 'Invalid JSON. Expected format: { "collection": "...", "type": "find|aggregate", ... }',
        limited: false,
      };
    }

    if (!parsed.collection || !parsed.type) {
      return {
        query: trimmedQuery,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: Date.now() - startedAt,
        error: 'MongoDB query must include "collection" and "type" (find|aggregate).',
        limited: false,
      };
    }

    try {
      const coll = this.db!.collection(parsed.collection);
      let rows: Record<string, unknown>[];
      let limit = parsed.limit ?? this.maxRows;

      if (parsed.type === 'aggregate') {
        const pipeline = parsed.pipeline ?? [];
        if (!pipeline.some((s: Record<string, unknown>) => '$limit' in s || s.$limit)) {
          pipeline.push({ $limit: limit });
        }
        const cursor = coll.aggregate(pipeline, { allowDiskUse: true });
        rows = (await cursor.toArray()) as Record<string, unknown>[];
      } else {
        let cursor = coll.find(parsed.filter ?? {}, { projection: parsed.projection });
        if (parsed.sort) cursor = cursor.sort(parsed.sort as Sort);
        cursor = cursor.limit(limit);
        rows = (await cursor.toArray()) as Record<string, unknown>[];
      }

      const limited = rows.length >= (parsed.limit ?? this.maxRows);
      const columns = this.extractColumns(rows);

      return {
        query: trimmedQuery,
        rows,
        rowCount: rows.length,
        columns,
        durationMs: Date.now() - startedAt,
        limited,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        query: trimmedQuery,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: Date.now() - startedAt,
        error: message,
        limited: false,
      };
    }
  }

  async introspectSchema(): Promise<TableInfo[]> {
    if (!this.db) throw new Error(`Connection ${this.id} is not initialized`);

    const collections = await this.db.listCollections().toArray();
    const tables: TableInfo[] = [];

    for (const coll of collections) {
      const name = coll.name;
      if (!this.isSafeIdentifier(name)) continue;

      let rowCount = 0;
      try {
        rowCount = await this.db!.collection(name).countDocuments();
      } catch {
        rowCount = 0;
      }

      let columns: ColumnInfo[] = [];
      try {
        const sample = await this.db!.collection(name).find().limit(20).toArray();
        columns = this.inferColumns(sample);
      } catch {
        columns = [];
      }

      tables.push({ name, rowCount, columns });
    }

    return tables;
  }

  private inferColumns(docs: Record<string, unknown>[]): ColumnInfo[] {
    const columnMap = new Map<string, Set<string>>();

    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        if (key === '_id') continue;
        if (!columnMap.has(key)) columnMap.set(key, new Set());
        columnMap.get(key)!.add(typeof value);
      }
    }

    return Array.from(columnMap.entries()).map(([name, types]) => ({
      name,
      type: this.guessType(types),
      nullable: docs.some((d) => d[name] === null || d[name] === undefined),
      isPrimaryKey: false,
      isForeignKey: false,
    }));
  }

  private guessType(types: Set<string>): string {
    if (types.has('number')) {
      const allInt = Array.from(types).every((t) => t === 'number');
      return allInt ? 'number' : 'number';
    }
    if (types.has('string')) return 'string';
    if (types.has('boolean')) return 'boolean';
    if (types.has('object')) return 'object';
    return Array.from(types)[0] ?? 'unknown';
  }

  private extractColumns(rows: Record<string, unknown>[]): string[] {
    const colSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key !== '_id') colSet.add(key);
      }
    }
    return Array.from(colSet);
  }

  private getDatabaseName(): string {
    const url = new URL(this.url);
    return url.pathname.replace(/^\//, '') || 'test';
  }

  private isSafeIdentifier(identifier: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(identifier);
  }
}
