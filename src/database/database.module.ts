import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { SchemaService } from './schema.service';
import { ConnectionManagerService } from './connection-manager.service';

@Module({
  providers: [ConnectionManagerService, DatabaseService, SchemaService],
  exports: [ConnectionManagerService, DatabaseService, SchemaService],
})
export class DatabaseModule {}
