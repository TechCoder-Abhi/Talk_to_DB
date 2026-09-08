import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AgentService } from './agent.service';
import { ResponseCacheService } from './response-cache.service';
import { SemanticCacheService } from './semantic-cache.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';

@Module({
  imports: [DatabaseModule],
  providers: [AgentService, ResponseCacheService, SemanticCacheService, GeminiProvider, GroqProvider],
  exports: [AgentService],
})
export class AgentModule {}
