import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiProviderSession,
  asRecord,
  asString,
  ProviderName,
  ProviderResponse,
  TokenUsage,
  ToolResultPayload,
} from './provider.types';
import { QuerybotToolCall, ToolDeclaration, ToolInput, ToolName } from '../tools';

/**
 * Groq pricing (USD per 1M tokens) — update when Groq changes rates.
 * Source: https://groq.com/pricing
 * Using compound-beta (tool use model) as reference: $0.75 input / $0.99 output.
 * Add model-specific entries keyed by a substring of the model name.
 */
const GROQ_PRICE_PER_1M: Record<string, { input: number; output: number }> = {
  'llama-3.3-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
  'gemma2-9b': { input: 0.20, output: 0.20 },
  'compound-beta': { input: 0.75, output: 0.99 },
  default: { input: 0.75, output: 0.99 },
};

function calcGroqCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(GROQ_PRICE_PER_1M).find((k) => model.includes(k)) ?? 'default';
  const price = GROQ_PRICE_PER_1M[key];
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

type GroqRole = 'system' | 'user' | 'assistant' | 'tool';

interface GroqMessage {
  role: GroqRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: GroqToolCall[];
}

interface GroqToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface GroqResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: GroqToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

@Injectable()
export class GroqProvider implements AiProvider {
  readonly name: ProviderName = 'groq';

  constructor(private readonly configService: ConfigService) { }

  isConfigured(): boolean {
    return this.configService.get<string>('ai.groqApiKey', '').length > 0;
  }

  createSession(systemPrompt: string, userMessage: string, tools: ToolDeclaration[]): AiProviderSession {
    return new GroqSession(
      this.configService.get<string>('ai.groqApiKey', ''),
      this.configService.get<string>('ai.groqModel', 'openai/gpt-oss-120b'),
      systemPrompt,
      userMessage,
      tools,
    );
  }
}

class GroqSession implements AiProviderSession {
  readonly name: ProviderName = 'groq';
  private readonly messages: GroqMessage[];
  private readonly tools: ToolDeclaration[];

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    systemPrompt: string,
    userMessage: string,
    tools: ToolDeclaration[],
  ) {
    this.messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    this.tools = tools;
  }

  async generate(): Promise<ProviderResponse> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.messages,
        tools: this.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: 'auto',
        max_completion_tokens: 2048,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as GroqResponse;
    const choice = data.choices?.[0];
    const message = choice?.message ?? {};
    const toolCalls = message.tool_calls ?? [];

    this.messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? inputTokens + outputTokens;
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: calcGroqCost(this.model, inputTokens, outputTokens),
    };

    return {
      textBlocks: message.content ? [message.content] : [],
      toolCalls: toolCalls
        .map((call) => this.toToolCall(call))
        .filter((call): call is QuerybotToolCall => Boolean(call)),
      stopReason: choice?.finish_reason,
      usage,
    };
  }

  appendToolResult(result: ToolResultPayload): void {
    this.messages.push({
      role: 'tool',
      tool_call_id: result.toolCallId,
      content: result.content,
    });
  }

  private toToolCall(call: GroqToolCall): QuerybotToolCall | undefined {
    const name = call.function.name;
    if (name !== 'execute_sql' && name !== 'execute_query' && name !== 'answer') {
      return undefined;
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = asRecord(JSON.parse(call.function.arguments));
    } catch {
      parsed = {};
    }

    return {
      id: call.id,
      name: name as ToolName,
      input: this.normalizeInput(name as ToolName, parsed),
    };
  }

  private normalizeInput(name: ToolName, args: Record<string, unknown>): ToolInput {
    if (name === 'execute_sql') {
      return {
        sql: asString(args.sql),
        reasoning: asString(args.reasoning, 'Execute SQL query.'),
      };
    }
    if (name === 'execute_query') {
      return {
        query: asString(args.query),
        reasoning: asString(args.reasoning, 'Execute database query.'),
      };
    }
    const chartType = args.chartType === 'bar' || args.chartType === 'line' ? args.chartType : 'none';
    return {
      summary: asString(args.summary),
      chartType,
      chartXKey: asString(args.chartXKey) || undefined,
      chartYKey: asString(args.chartYKey) || undefined,
    };
  }
}
