import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../database/schema.service';
import { ConnectionManagerService } from '../database/connection-manager.service';
import { SchemaInfo } from '../database/connections/connection.interface';
import { buildSystemPrompt, buildUserMessage } from './prompts';
import { isAnswerInput, isExecuteSqlInput, isExecuteQueryInput, QuerybotToolCall, getTools } from './tools';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { ResponseCacheService } from './response-cache.service';
import { SemanticCacheService } from './semantic-cache.service';
import {
  AiProvider,
  AiProviderSession,
  ProviderName,
  TokenUsage,
  ToolResultPayload,
} from './providers/provider.types';

export interface AgentStep {
  type: 'thinking' | 'sql' | 'result' | 'error' | 'answer';
  content: string;
  provider?: ProviderName;
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
  provider?: ProviderName;
}

export type StepCallback = (step: AgentStep) => void;

interface ProviderRunState {
  steps: AgentStep[];
  lastSql?: string;
  lastRows?: Record<string, unknown>[];
  lastColumns?: string[];
}

interface SessionUsage {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

function emptySessionUsage(): SessionUsage {
  return { callCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
}

function mergeUsage(session: SessionUsage, call: TokenUsage): void {
  session.callCount += 1;
  session.inputTokens += call.inputTokens;
  session.outputTokens += call.outputTokens;
  session.totalTokens += call.totalTokens;
  session.estimatedCostUsd += call.estimatedCostUsd;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly schemaService: SchemaService,
    private readonly configService: ConfigService,
    private readonly connectionManager: ConnectionManagerService,
    private readonly geminiProvider: GeminiProvider,
    private readonly groqProvider: GroqProvider,
    private readonly responseCache: ResponseCacheService,
    private readonly semanticCache: SemanticCacheService,
  ) {}

  async runAgent(
    question: string,
    connectionId?: string,
    onStep?: StepCallback,
  ): Promise<AgentResponse> {
    const trimmedQuestion = buildUserMessage(question);
    if (!trimmedQuestion) {
      return this.failure([], 'Question is required.');
    }

    const conn = connectionId
      ? this.connectionManager.getConnection(connectionId)
      : this.connectionManager.getDefaultConnection();

    if (!conn) {
      return this.failure([], 'No database connection is available. Check your DATABASE_URL or DATABASES configuration.');
    }

    const activeConnectionId = conn.id;
    const queryLanguage = conn.getQueryLanguage();
    const dbName = conn.name;

    const schema = await this.schemaService.introspectSchema(activeConnectionId);
    const schemaString = await this.schemaService.toPromptString(activeConnectionId, schema);
    if (schema.tables.length === 0) {
      return {
        steps: [],
        finalAnswer: schemaString,
        chartType: 'none',
        success: false,
      };
    }

    const cacheKey = this.makeCacheKey(trimmedQuestion, activeConnectionId, schema);
    const cached = this.responseCache.get(cacheKey);
    if (cached) {
      this.logger.log(`[CACHE] EXACT HIT — key: ${cacheKey.slice(0, 12)}… | question: "${question.slice(0, 60)}${question.length > 60 ? '…' : ''}"`);
      for (const step of cached.steps) {
        onStep?.(step);
      }
      return cached;
    }

    const schemaFingerprint = this.schemaFingerprint(schema);
    const semanticHit = await this.semanticCache.search(trimmedQuestion, activeConnectionId, schemaFingerprint);
    if (semanticHit) {
      this.logger.log(`[CACHE] SEMANTIC HIT — distance: ${semanticHit.distance.toFixed(4)} | question: "${question.slice(0, 60)}${question.length > 60 ? '…' : ''}"`);
      for (const step of semanticHit.response.steps) {
        onStep?.(step);
      }
      return semanticHit.response;
    }

    const systemPrompt = buildSystemPrompt(schemaString, queryLanguage, dbName);
    const tools = getTools(queryLanguage);
    const providers = this.resolveProviders();
    if (providers.length === 0) {
      return this.failure(
        [],
        'No AI provider is configured. Set GEMINI_API_KEY, GROQ_API_KEY, or both.',
      );
    }

    const accumulatedSteps: AgentStep[] = [];
    for (const provider of providers) {
      try {
        const result = await this.runWithProvider(
          provider,
          systemPrompt,
          tools,
          trimmedQuestion,
          activeConnectionId,
          queryLanguage,
          (step) => {
            accumulatedSteps.push(step);
            onStep?.(step);
          },
        );
        if (result.success) {
          this.responseCache.set(cacheKey, result);
          this.logger.log(`[CACHE] EXACT STORED — key: ${cacheKey.slice(0, 12)}… | TTL: ${this.configService.get<number>('cacheTtl', 300)}s`);
          await this.semanticCache.store(trimmedQuestion, result, activeConnectionId, schemaFingerprint);
          this.logger.log(`[CACHE] SEMANTIC STORED — question: "${question.slice(0, 60)}${question.length > 60 ? '…' : ''}"`);
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${provider.name} failed: ${message}`);
        const step: AgentStep = {
          type: 'error',
          provider: provider.name,
          content:
            providers.length > 1
              ? `${provider.name} failed, trying fallback provider.`
              : `${provider.name} failed: ${message}`,
        };
        accumulatedSteps.push(step);
        onStep?.(step);
      }
    }

    return this.failure(
      accumulatedSteps,
      'AI service error: all configured providers failed before producing an answer.',
    );
  }

  private async runWithProvider(
    provider: AiProvider,
    systemPrompt: string,
    tools: ReturnType<typeof getTools>,
    question: string,
    connectionId: string,
    queryLanguage: 'sql' | 'mongodb',
    onStep: StepCallback,
  ): Promise<AgentResponse> {
    const session = provider.createSession(systemPrompt, question, tools);
    const state: ProviderRunState = { steps: [] };
    const sessionUsage = emptySessionUsage();
    const maxIterations = 10;
    const maxQueryAttempts = 3;
    let queryAttempts = 0;

    this.logger.log(
      `[AI] Session start — provider: ${provider.name} | db: ${connectionId} | question: "${question.slice(0, 80)}${question.length > 80 ? '…' : ''}"`,
    );

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await session.generate();

      if (response.usage) {
        mergeUsage(sessionUsage, response.usage);
        this.logger.log(
          `[AI] Call #${sessionUsage.callCount} (${provider.name}) — ` +
          `in: ${response.usage.inputTokens} | out: ${response.usage.outputTokens} | ` +
          `total: ${response.usage.totalTokens} | ~$${response.usage.estimatedCostUsd.toFixed(6)}`,
        );
      }

      for (const text of response.textBlocks) {
        this.addStep(state, onStep, { type: 'thinking', content: text, provider: provider.name });
      }

      let answerCalled = false;
      for (const toolCall of response.toolCalls) {
        const queryToolName = queryLanguage === 'mongodb' ? 'execute_query' : 'execute_sql';

        if (toolCall.name === queryToolName) {
          queryAttempts += 1;
          const toolResult = await this.handleQuery(
            toolCall,
            session,
            provider.name,
            state,
            onStep,
            queryAttempts > maxQueryAttempts,
            connectionId,
          );
          session.appendToolResult(toolResult);
        }

        if (toolCall.name === 'answer') {
          answerCalled = true;
          if (!isAnswerInput(toolCall.input)) {
            throw new Error('Provider returned invalid answer tool input.');
          }
          const step: AgentStep = {
            type: 'answer',
            provider: provider.name,
            content: toolCall.input.summary,
          };
          this.addStep(state, onStep, step);

          this.logger.log(
            `[AI] Session complete — provider: ${provider.name} | ` +
            `calls: ${sessionUsage.callCount} | ` +
            `total tokens: ${sessionUsage.totalTokens} ` +
            `(in: ${sessionUsage.inputTokens} / out: ${sessionUsage.outputTokens}) | ` +
            `estimated cost: $${sessionUsage.estimatedCostUsd.toFixed(6)}`,
          );

          return {
            steps: state.steps,
            finalAnswer: toolCall.input.summary,
            lastSql: state.lastSql,
            lastRows: state.lastRows,
            lastColumns: state.lastColumns,
            chartType: toolCall.input.chartType,
            chartXKey: toolCall.input.chartXKey,
            chartYKey: toolCall.input.chartYKey,
            success: true,
            provider: provider.name,
          };
        }
      }

      if (answerCalled) break;

      if (response.toolCalls.length === 0 && response.stopReason !== 'tool_calls') {
        break;
      }
    }

    this.logger.warn(
      `[AI] Session ended without answer — provider: ${provider.name} | ` +
      `calls: ${sessionUsage.callCount} | ` +
      `total tokens: ${sessionUsage.totalTokens} ` +
      `(in: ${sessionUsage.inputTokens} / out: ${sessionUsage.outputTokens})`,
    );

    return {
      steps: state.steps,
      finalAnswer: 'Could not generate an answer after maximum iterations.',
      lastSql: state.lastSql,
      lastRows: state.lastRows,
      lastColumns: state.lastColumns,
      chartType: 'none',
      success: false,
      provider: provider.name,
    };
  }

  private async handleQuery(
    toolCall: QuerybotToolCall,
    session: AiProviderSession,
    provider: ProviderName,
    state: ProviderRunState,
    onStep: StepCallback,
    exceededAttempts: boolean,
    connectionId: string,
  ): Promise<ToolResultPayload> {
    let queryText = '';

    if (isExecuteSqlInput(toolCall.input)) {
      queryText = toolCall.input.sql;
    } else if (isExecuteQueryInput(toolCall.input)) {
      queryText = toolCall.input.query;
    } else {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: 'Invalid query input.',
        isError: true,
      };
    }

    const step: AgentStep = {
      type: 'sql',
      provider,
      content: toolCall.input.reasoning,
      sql: queryText,
    };
    this.addStep(state, onStep, step);

    if (exceededAttempts) {
      const message = 'Maximum query correction attempts reached. Provide an answer explaining the failure.';
      this.addStep(state, onStep, { type: 'error', provider, content: message, sql: queryText });
      return { toolCallId: toolCall.id, name: toolCall.name, content: message, isError: true };
    }

    const result = await this.databaseService.executeQuery(connectionId, queryText);
    if (result.error) {
      this.addStep(state, onStep, {
        type: 'error',
        provider,
        content: result.error,
        sql: result.query,
        durationMs: result.durationMs,
      });
      return { toolCallId: toolCall.id, name: toolCall.name, content: `Query Error: ${result.error}`, isError: true };
    }

    state.lastSql = result.query;
    state.lastRows = result.rows;
    state.lastColumns = result.columns;

    const limitNote = result.limited ? ' Results limited to the configured maximum row count.' : '';
    this.addStep(state, onStep, {
      type: 'result',
      provider,
      content: `${result.rowCount} rows in ${result.durationMs}ms.${limitNote}`,
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
    });

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify({
        columns: result.columns,
        rows: result.rows.slice(0, 50),
        rowCount: result.rowCount,
        limited: result.limited,
      }),
    };
  }

  private addStep(state: ProviderRunState, onStep: StepCallback, step: AgentStep): void {
    state.steps.push(step);
    onStep(step);
  }

  private resolveProviders(): AiProvider[] {
    const mode = this.configService.get<string>('ai.provider', 'auto');
    const configured = [this.geminiProvider, this.groqProvider].filter((provider) =>
      provider.isConfigured(),
    );

    if (mode === 'gemini') return this.geminiProvider.isConfigured() ? [this.geminiProvider] : [];
    if (mode === 'groq') return this.groqProvider.isConfigured() ? [this.groqProvider] : [];
    return configured;
  }

  private failure(steps: AgentStep[], finalAnswer: string): AgentResponse {
    return { steps, finalAnswer, chartType: 'none', success: false };
  }

  private makeCacheKey(question: string, connectionId: string, schema: SchemaInfo): string {
    const fingerprint = this.schemaFingerprint(schema);
    return `${question}|${connectionId}|${fingerprint}`;
  }

  private schemaFingerprint(schema: SchemaInfo): string {
    let hash = 5381;
    for (const table of schema.tables) {
      hash = ((hash << 5) + hash + this.strCode(table.name)) | 0;
      hash = ((hash << 5) + hash + table.rowCount) | 0;
      for (const col of table.columns) {
        hash = ((hash << 5) + hash + this.strCode(col.name)) | 0;
        hash = ((hash << 5) + hash + this.strCode(col.type)) | 0;
        if (col.isPrimaryKey) hash = ((hash << 5) + hash + 1) | 0;
      }
    }
    return hash.toString(36);
  }

  private strCode(s: string): number {
    let code = 0;
    for (let i = 0; i < s.length; i++) {
      code = ((code << 3) - code + s.charCodeAt(i)) | 0;
    }
    return code;
  }
}
