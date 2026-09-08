import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbConnection, DbConnectionConfig } from './connections/connection.interface';
import { PostgresConnection } from './connections/postgres.connection';
import { MysqlConnection } from './connections/mysql.connection';
import { MongoDbConnection } from './connections/mongodb.connection';

@Injectable()
export class ConnectionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionManagerService.name);
  private readonly connections = new Map<string, DbConnection>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const configs = this.configService.get<DbConnectionConfig[]>('databases', []);

    if (configs.length === 0) {
      this.logger.warn('No database connections configured. Set DATABASE_URL, DATABASE_URL1...N, or DATABASES env var.');
      return;
    }

    for (const config of configs) {
      try {
        const conn = this.createConnection(config);
        await conn.connect();
        this.connections.set(config.id, conn);
        this.logger.log(`Registered connection '${config.id}' (${config.type})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to connect '${config.id}' (${config.type}): ${message}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const [id, conn] of this.connections) {
      await conn.disconnect().catch(() => {});
      this.logger.log(`Disconnected '${id}'`);
    }
    this.connections.clear();
  }

  getConnections(): { id: string; type: string; name: string }[] {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
    }));
  }

  getConnection(id: string): DbConnection | undefined {
    return this.connections.get(id);
  }

  getDefaultConnection(): DbConnection | undefined {
    return this.connections.get('default') ?? this.connections.values().next().value;
  }

  private createConnection(config: DbConnectionConfig): DbConnection {
    switch (config.type) {
      case 'mysql':
        return new MysqlConnection(config);
      case 'mongodb':
        return new MongoDbConnection(config);
      default:
        return new PostgresConnection(config);
    }
  }
}
