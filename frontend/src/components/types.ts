export interface AgentStep {
  type: 'thinking' | 'sql' | 'result' | 'error' | 'answer';
  content: string;
  provider?: 'gemini' | 'groq';
  sql?: string;
  rows?: Record<string, unknown>[];
  columns?: string[];
  rowCount?: number;
  durationMs?: number;
}

export interface AgentResponse {
  steps: AgentStep[];
  finalAnswer: string;
  lastSql?: string;
  lastRows?: Record<string, unknown>[];
  lastColumns?: string[];
  chartType: 'bar' | 'line' | 'none';
  chartXKey?: string;
  chartYKey?: string;
  success: boolean;
  provider?: 'gemini' | 'groq';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: AgentStep[];
  rows?: Record<string, unknown>[];
  columns?: string[];
  sql?: string;
  chartType?: 'bar' | 'line' | 'none';
  chartXKey?: string;
  chartYKey?: string;
  isStreaming?: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { table: string; column: string };
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
}

export interface SchemaInfo {
  tables: TableInfo[];
  generatedAt: string;
}

export interface DbConnectionInfo {
  id: string;
  type: string;
  name: string;
}
