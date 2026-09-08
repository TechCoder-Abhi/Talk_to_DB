import { Logger } from '@nestjs/common';
import { createPool, Pool, PoolConnection, RowDataPacket, FieldPacket } from 'mysql2/promise';
import { DbConnection, DbConnectionConfig, QueryExecution, TableInfo, ColumnInfo } from './connection.interface';

interface TableRow extends RowDataPacket {
  TABLE_NAME: string;
}

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: 'YES' | 'NO';
  COLUMN_KEY: string;
}

interface ForeignKeyRow extends RowDataPacket {
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

interface RowCountRow extends RowDataPacket {
  row_count: number | null;
}

export class MysqlConnection extends DbConnection {
  private readonly logger = new Logger(`MysqlConnection:${this.id}`);
  private pool?: Pool;

  constructor(config: DbConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    const url = new URL(this.url);
    this.pool = createPool({
      host: url.hostname,
      port: Number.parseInt(url.port, 10) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      waitForConnections: true,
      connectionLimit: 10,
    });
    try {
      const conn = await this.pool.getConnection();
      conn.release();
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
      const [rows, fields] = await this.pool!.query<RowDataPacket[]>(executionQuery);
      const rowData = rows as Record<string, unknown>[];
      return {
        query: executionQuery,
        rows: rowData,
        rowCount: rowData.length,
        columns: (fields as FieldPacket[]).map((f) => f.name),
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
    const dbName = this.getDatabaseName();
    const tableResult = await this.pool!.query<TableRow[]>(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [dbName],
    );
    const [tables] = tableResult;

    const result: TableInfo[] = [];
    for (const table of tables) {
      if (!this.isSafeIdentifier(table.TABLE_NAME)) continue;

      const columns = await this.loadTableColumns(table.TABLE_NAME, dbName);
      const rowCount = await this.getRowCount(table.TABLE_NAME, dbName);

      result.push({ name: table.TABLE_NAME, rowCount, columns });
    }

    return result;
  }

  private async loadTableColumns(tableName: string, dbName: string): Promise<ColumnInfo[]> {
    const [columnRows] = await this.pool!.query<ColumnRow[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ORDINAL_POSITION`,
      [dbName, tableName],
    );

    const [fkRows] = await this.pool!.query<ForeignKeyRow[]>(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.key_column_usage
       WHERE table_schema = ? AND table_name = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName, tableName],
    );

    return columnRows
      .filter((col) => this.isSafeIdentifier(col.COLUMN_NAME))
      .map((col) => {
        const fk = fkRows.find((fk) => fk.COLUMN_NAME === col.COLUMN_NAME);
        return {
          name: col.COLUMN_NAME,
          type: col.DATA_TYPE,
          nullable: col.IS_NULLABLE === 'YES',
          isPrimaryKey: col.COLUMN_KEY === 'PRI',
          isForeignKey: Boolean(fk),
          references: fk
            ? { table: fk.REFERENCED_TABLE_NAME, column: fk.REFERENCED_COLUMN_NAME }
            : undefined,
        };
      });
  }

  private async getRowCount(tableName: string, dbName: string): Promise<number> {
    try {
      const [rows] = await this.pool!.query<RowCountRow[]>(
        `SELECT TABLE_ROWS AS row_count FROM information_schema.tables
         WHERE table_schema = ? AND table_name = ?`,
        [dbName, tableName],
      );
      return rows[0]?.row_count ?? 0;
    } catch {
      return 0;
    }
  }

  private getDatabaseName(): string {
    const url = new URL(this.url);
    return url.pathname.replace(/^\//, '');
  }

  private validateReadOnlySql(sql: string): string | undefined {
    if (!sql) return 'SQL query is empty.';
    const scrubbed = this.scrubSql(sql);
    if (!/^\s*(select|with)\b/i.test(scrubbed)) {
      return 'Only read-only SELECT queries are allowed.';
    }
    const forbidden = /\b(drop|delete|truncate|insert|update|create|alter|grant|revoke|merge|call|copy|execute|replace|load)\b/i;
    const match = scrubbed.match(forbidden);
    if (match) return `Read-only safety check blocked forbidden keyword: ${match[1].toUpperCase()}.`;
    const semicolonBeforeEnd = /;\s*\S/.test(scrubbed);
    if (semicolonBeforeEnd) return 'Multiple SQL statements are not allowed.';
    return undefined;
  }

  private scrubSql(sql: string): string {
    return sql
      .replace(/--.*$/gm, ' ')
      .replace(/#.*$/gm, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/"(?:[^"]|"")*"/g, '""')
      .replace(/`(?:[^`]|``)*`/g, '``');
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
