export type DbType = 'postgres' | 'mysql' | 'mongodb';

export interface DbConnectionConfig {
  id: string;
  type: DbType;
  url: string;
  name: string;
  schema?: string;
  maxRows?: number;
}

export interface QueryExecution {
  query: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: string[];
  durationMs: number;
  error?: string;
  limited: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  references?: { table: string; column: string };
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
}

export interface SchemaInfo {
  tables: TableInfo[];
  generatedAt: Date;
}

export abstract class DbConnection {
  readonly id: string;
  readonly type: DbType;
  readonly name: string;
  readonly schema: string;
  readonly maxRows: number;
  readonly url: string;

  constructor(config: DbConnectionConfig) {
    this.id = config.id;
    this.type = config.type;
    this.name = config.name;
    this.url = config.url;
    this.schema = config.schema ?? 'public';
    this.maxRows = config.maxRows ?? 500;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(query: string): Promise<QueryExecution>;
  abstract introspectSchema(): Promise<TableInfo[]>;
  abstract getQueryLanguage(): 'sql' | 'mongodb';
}
