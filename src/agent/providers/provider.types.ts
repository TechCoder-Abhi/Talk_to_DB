import { ToolDeclaration } from '../tools';

export type ProviderName = 'gemini' | 'groq';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ProviderResponse {
  textBlocks: string[];
  toolCalls: import('../tools').QuerybotToolCall[];
  stopReason?: string;
  usage?: TokenUsage;
}

export interface ToolResultPayload {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface AiProviderSession {
  readonly name: ProviderName;
  generate(): Promise<ProviderResponse>;
  appendToolResult(result: ToolResultPayload): void;
}

export interface AiProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  createSession(systemPrompt: string, userMessage: string, tools: ToolDeclaration[]): AiProviderSession;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
