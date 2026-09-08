import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentResponse } from './agent.service';

interface CachedEntry {
  response: AgentResponse;
  expiresAt: number;
}

@Injectable()
export class ResponseCacheService {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly defaultTtlMs: number;

  constructor(configService: ConfigService) {
    this.defaultTtlMs = (configService.get<number>('cacheTtl') ?? 300) * 1000;
  }

  get(key: string): AgentResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.response;
  }

  set(key: string, response: AgentResponse, ttlMs?: number): void {
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    this.evictExpired();
    return this.cache.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }
}
