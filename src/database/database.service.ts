import { Injectable, Logger } from '@nestjs/common';
import { ConnectionManagerService } from './connection-manager.service';
import { QueryExecution } from './connections/connection.interface';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly connectionManager: ConnectionManagerService) {}

  async executeQuery(connectionId: string | undefined, query: string): Promise<QueryExecution> {
    const conn = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getDefaultConnection();

    if (!conn) {
      return {
        query,
        rows: [],
        rowCount: 0,
        columns: [],
        durationMs: 0,
        error: 'No database connection available.',
        limited: false,
      };
    }

    return conn.executeQuery(query);
  }

  getQueryLanguage(connectionId?: string): 'sql' | 'mongodb' {
    const conn = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getDefaultConnection();

    return conn?.getQueryLanguage() ?? 'sql';
  }
}
