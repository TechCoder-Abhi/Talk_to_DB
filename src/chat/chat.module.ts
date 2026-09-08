import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { DatabaseModule } from '../database/database.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [AgentModule, DatabaseModule],
  controllers: [ChatController],
  providers: [ChatGateway],
})
export class ChatModule {}
