import { Logger } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { DbConnection, DbConnectionConfig, QueryExecution, TableInfo, ColumnInfo } from './connection.interface';

interface TableRow extends Record<string, unknown> {
  table_name: string;
}

interface ColumnRow extends Record<string, unknown> {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  is_primary_key: boolean;
}

interface ForeignKeyRow extends Record<string, unknown> {
  column_name: string;
  foreign_table: string;
  foreign_column: string;
}

interface RowCountRow extends Record<string, unknown> {
  row_count: string | number | bigint | null;
}

export class PostgresConnection extends DbConnection {
  private readonly logger = new Logger(`PostgresConnection:${this.id}`);
  private pool?: Pool;

  constructor(config: DbConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    this.pool = new Pool({ connectionString: this.url, max: 10 });
    try {
      await this.pool.query('SELECT 1');
      this.logger.log('Connection established');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Connection failed: ${message}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
  }

  getQueryLanguage(): 'sql' | 'mongodb' {
    return 'sql';
  }

  async executeQuery(query: string): Promise<QueryExecution> {
    const startedAt = Date.now();
    const trimmedQuery = query.trim();
    const safetyError = this.validateReadOnlySql(trimmedQuery);

    if (safetyError) {
      return {
        query: trimmedQuery,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: Date.now() - startedAt,
        error: safetyError,
        limited: false,
      };
    }

    const executionQuery = this.applyLimit(trimmedQuery, this.maxRows);
    const limited = executionQuery !== trimmedQuery;

    try {
      const result = await this.queryInternal(executionQuery);
      return {
        query: executionQuery,
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? result.rows.length,
        columns: result.fields.map((field) => field.name),
        durationMs: Date.now() - startedAt,
        limited,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        query: executionQuery,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: Date.now() - startedAt,
        error: message,
        limited,
      };
    }
  }

  async introspectSchema(): Promise<TableInfo[]> {
    const tableResult = await this.queryInternal<TableRow>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [this.schema],
    );

    const tables: TableInfo[] = [];
    for (const table of tableResult.rows) {
      if (!this.isSafeIdentifier(table.table_name)) continue;

      const [columns] = await this.loadTableDetails(table.table_name);
      const rowCount = await this.getRowCount(table.table_name);

      tables.push({ name: table.table_name, rowCount, columns });
    }

    return tables;
  }

  private async loadTableDetails(tableName: string): Promise<[ColumnInfo[]]> {
    const columnResult = await this.queryInternal<ColumnRow>(
      `SELECT
         c.column_name, c.data_type, c.is_nullable,
         CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT ku.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku
           ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_name = $1 AND tc.table_schema = $2
       ) pk ON c.column_name = pk.column_name
       WHERE c.table_name = $1 AND c.table_schema = $2
       ORDER BY c.ordinal_position`,
      [tableName, this.schema],
    );

    const fkResult = await this.queryInternal<ForeignKeyRow>(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = $1 AND tc.table_schema = $2`,
      [tableName, this.schema],
    );

    const foreignKeys = fkResult.rows.filter(
      (fk) => this.isSafeIdentifier(fk.column_name) && this.isSafeIdentifier(fk.foreign_table) && this.isSafeIdentifier(fk.foreign_column),
    );

    const columns: ColumnInfo[] = columnResult.rows
      .filter((col) => this.isSafeIdentifier(col.column_name))
      .map((col) => {
        const fk = foreignKeys.find((fk) => fk.column_name === col.column_name);
        return {
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          isPrimaryKey: col.is_primary_key,
          isForeignKey: Boolean(fk),
          references: fk ? { table: fk.foreign_table, column: fk.foreign_column } : undefined,
        };
      });

    return [columns];
  }

  private async getRowCount(tableName: string): Promise<number> {
    try {
      const result = await this.queryInternal<RowCountRow>(
        `SELECT reltuples::bigint AS row_count FROM pg_class WHERE oid = to_regclass($1)`,
        [`${this.schema}.${tableName}`],
      );
      return this.parseRowCount(result.rows[0]?.row_count);
    } catch {
      return 0;
    }
  }

  private parseRowCount(value: RowCountRow['row_count']): number {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return Math.max(0, Math.round(value));
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
    return 0;
  }

  private async queryInternal<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    if (!this.pool) throw new Error(`Connection ${this.id} is not initialized`);
    return this.pool.query<T>(text, [...values]);
  }

  private validateReadOnlySql(sql: string): string | undefined {
    if (!sql) return 'SQL query is empty.';
    const scrubbed = this.scrubSql(sql);
    if (!/^\s*(select|with)\b/i.test(scrubbed)) {
      return 'Only read-only SELECT queries are allowed.';
    }
    const forbidden = /\b(drop|delete|truncate|insert|update|create|alter|grant|revoke|merge|call|copy|execute)\b/i;
    const match = scrubbed.match(forbidden);
    if (match) return `Read-only safety check blocked forbidden keyword: ${match[1].toUpperCase()}.`;
    const semicolonBeforeEnd = /;\s*\S/.test(scrubbed);
    if (semicolonBeforeEnd) return 'Multiple SQL statements are not allowed.';
    return undefined;
  }

  private scrubSql(sql: string): string {
    return sql
      .replace(/--.*$/gm, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/"(?:[^"]|"")*"/g, '""')
      .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$');
  }

  private applyLimit(sql: string, maxRows: number): string {
    const withoutSemicolon = sql.replace(/;\s*$/, '');
    const scrubbed = this.scrubSql(withoutSemicolon);
    if (/\blimit\s+\d+\b/i.test(scrubbed)) return withoutSemicolon;
    return `${withoutSemicolon} LIMIT ${maxRows}`;
  }

  private isSafeIdentifier(identifier: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(identifier);
  }
}
