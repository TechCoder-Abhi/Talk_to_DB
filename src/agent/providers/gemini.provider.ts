import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiProviderSession,
  asRecord,
  asString,
  JsonValue,
  ProviderName,
  ProviderResponse,
  TokenUsage,
  ToolResultPayload,
} from './provider.types';
import { QuerybotToolCall, ToolDeclaration, ToolInput, ToolName } from '../tools';

/**
 * Gemini pricing (USD per 1M tokens) — update when Google changes rates.
 * Source: https://ai.google.dev/pricing
 * Using gemini-2.5-pro as reference: $1.25 input / $10.00 output (up to 200k context).
 */
const GEMINI_PRICE_PER_1M: Record<string, { input: number; output: number }> = {
  default: { input: 1.25, output: 10.0 },
};

function calcGeminiCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(GEMINI_PRICE_PER_1M).find((k) => model.includes(k)) ?? 'default';
  const price = GEMINI_PRICE_PER_1M[key];
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

interface GeminiPart {
  text?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: JsonValue;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name: ProviderName = 'gemini';

  constructor(private readonly configService: ConfigService) { }

  isConfigured(): boolean {
    return this.configService.get<string>('ai.geminiApiKey', '').length > 0;
  }

  createSession(systemPrompt: string, userMessage: string, tools: ToolDeclaration[]): AiProviderSession {
    return new GeminiSession(
      this.configService.get<string>('ai.geminiApiKey', ''),
      this.configService.get<string>('ai.geminiModel', 'gemini-3-pro-preview'),
      systemPrompt,
      userMessage,
      tools,
    );
  }
}

class GeminiSession implements AiProviderSession {
  readonly name: ProviderName = 'gemini';
  private readonly contents: GeminiContent[];
  private readonly tools: ToolDeclaration[];

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly systemPrompt: string,
    userMessage: string,
    tools: ToolDeclaration[],
  ) {
    this.contents = [{ role: 'user', parts: [{ text: userMessage }] }];
    this.tools = tools;
  }

  async generate(): Promise<ProviderResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: this.systemPrompt }],
      },
      contents: this.contents,
      tools: [
        {
          functionDeclarations: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ],
      generationConfig: {
        maxOutputTokens: 2048,
      },
    };

    let response = await this.request(url, requestBody);
    for (let attempt = 1; !response.ok && response.status === 503 && attempt <= 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      response = await this.request(url, requestBody);
    }

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    this.contents.push({ role: 'model', parts });

    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: calcGeminiCost(this.model, inputTokens, outputTokens),
    };

    return {
      textBlocks: parts.map((part) => part.text).filter((text): text is string => Boolean(text)),
      toolCalls: parts
        .map((part, index) => this.toToolCall(part, index))
        .filter((call): call is QuerybotToolCall => Boolean(call)),
      stopReason: candidate?.finishReason,
      usage,
    };
  }

  private request(url: string, body: object): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  appendToolResult(result: ToolResultPayload): void {
    this.contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: result.toolCallId,
            name: result.name,
            response: {
              ok: !result.isError,
              content: result.content,
            },
          },
        },
      ],
    });
  }

  private toToolCall(part: GeminiPart, index: number): QuerybotToolCall | undefined {
    const functionCall = part.functionCall;
    if (!functionCall) {
      return undefined;
    }

    const name = functionCall.name;
    if (name !== 'execute_sql' && name !== 'execute_query' && name !== 'answer') {
      return undefined;
    }

    const args = asRecord(functionCall.args);
    return {
      id: functionCall.id ?? `gemini-call-${Date.now()}-${index}`,
      name: name as ToolName,
      input: this.normalizeInput(name as ToolName, args),
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
