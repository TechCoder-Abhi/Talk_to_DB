import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { SchemaService } from '../database/schema.service';
import { ConnectionManagerService } from '../database/connection-manager.service';

@Controller()
export class ChatController {
  constructor(
    private readonly agentService: AgentService,
    private readonly schemaService: SchemaService,
    private readonly connectionManager: ConnectionManagerService,
  ) {}

  @Get('schema')
  async getSchema(@Query('connectionId') connectionId?: string) {
    const connId = connectionId || this.connectionManager.getDefaultConnection()?.id;
    if (!connId) {
      return { tables: [], generatedAt: new Date().toISOString() };
    }
    return this.schemaService.introspectSchema(connId);
  }

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('connections')
  listConnections() {
    return this.connectionManager.getConnections();
  }

  @Post('chat')
  async chat(@Body() body: { question?: string; connectionId?: string }) {
    if (!body.question?.trim()) {
      throw new BadRequestException('question is required');
    }
    return this.agentService.runAgent(body.question, body.connectionId);
  }
}
