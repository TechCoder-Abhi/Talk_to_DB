import { Injectable, Logger } from '@nestjs/common';
import { ConnectionManagerService } from './connection-manager.service';
import { TableInfo, SchemaInfo } from './connections/connection.interface';

interface CachedSchema {
  data: SchemaInfo;
  cachedAt: number;
}

@Injectable()
export class SchemaService {
  private readonly logger = new Logger(SchemaService.name);
  private readonly cache = new Map<string, CachedSchema>();
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly connectionManager: ConnectionManagerService) {}

  private cacheKey(connectionId: string): string {
    return connectionId;
  }

  async introspectSchema(connectionId: string): Promise<SchemaInfo> {
    const now = Date.now();
    const key = this.cacheKey(connectionId);
    const cached = this.cache.get(key);

    if (cached && now - cached.cachedAt < this.cacheTtlMs) {
      return cached.data;
    }

    const conn = this.connectionManager.getConnection(connectionId);
    if (!conn) {
      return { tables: [], generatedAt: new Date() };
    }

    try {
      const tables = await conn.introspectSchema();
      const schema: SchemaInfo = { tables, generatedAt: new Date() };
      this.cache.set(key, { data: schema, cachedAt: now });
      return schema;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Schema introspection failed for '${connectionId}': ${message}`);
      return { tables: [], generatedAt: new Date() };
    }
  }

  async toPromptString(connectionId: string, schema: SchemaInfo): Promise<string> {
    const conn = this.connectionManager.getConnection(connectionId);
    const dbName = conn?.name ?? 'database';

    if (schema.tables.length === 0) {
      return `No tables found in '${dbName}'.`;
    }

    const lines = schema.tables.map((table) => {
      const columns = table.columns
        .map((column) => this.formatColumn(column))
        .join(', ');
      return `- ${table.name} (≈${table.rowCount.toLocaleString()} rows): ${columns}`;
    });

    return `Tables:\n${lines.join('\n')}`;
  }

  async getAllSchemas(): Promise<{ id: string; name: string; type: string; schema: SchemaInfo }[]> {
    const connections = this.connectionManager.getConnections();
    const results: { id: string; name: string; type: string; schema: SchemaInfo }[] = [];

    for (const conn of connections) {
      const schema = await this.introspectSchema(conn.id);
      results.push({ id: conn.id, name: conn.name, type: conn.type, schema });
    }

    return results;
  }

  private formatColumn(column: { name: string; type: string; isPrimaryKey?: boolean; isForeignKey?: boolean; references?: { table: string; column: string } }): string {
    const tags = [
      column.isPrimaryKey ? 'PK' : '',
      column.isForeignKey && column.references
        ? `FK→${column.references.table}.${column.references.column}`
        : '',
    ].filter(Boolean);
    const suffix = tags.length > 0 ? ` ${tags.join(' ')}` : '';
    return `${column.name} ${column.type.toUpperCase()}${suffix}`;
  }
}
