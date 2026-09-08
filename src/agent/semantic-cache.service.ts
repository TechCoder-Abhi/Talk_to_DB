import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { AgentResponse } from './agent.service';

interface SemanticCacheEntry {
  response: AgentResponse;
  distance: number;
  question: string;
}

@Injectable()
export class SemanticCacheService implements OnModuleInit {
  private db!: Database.Database;
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly embeddingDim = 3072;
  private readonly defaultThreshold: number;
  private readonly defaultTtlMs: number;
  private readonly geminiApiKey: string;
  private readonly embeddingModel: string;
  private readonly enabled: boolean;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(configService: ConfigService) {
    this.geminiApiKey = configService.get<string>('ai.geminiApiKey', '');
    this.embeddingModel = configService.get<string>('ai.geminiEmbeddingModel', 'gemini-embedding-001');
    this.defaultThreshold = configService.get<number>('cacheSimilarityThreshold', 0.92);
    this.defaultTtlMs = (configService.get<number>('cacheTtl', 300)) * 1000;
    this.enabled = this.defaultTtlMs > 0 && !!this.geminiApiKey;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      if (!this.geminiApiKey) {
        this.logger.warn('Semantic cache disabled: GEMINI_API_KEY not set (required for embeddings)');
      } else {
        this.logger.log('Semantic cache disabled: CACHE_TTL is 0');
      }
      return;
    }

    const dbDir = path.join(process.cwd(), 'data');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'querybot-cache.db');
    this.logger.log(`Semantic cache DB: ${dbPath}`);

    this.db = new Database(dbPath);
    sqliteVec.load(this.db);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_cache_3072 USING vec0(
        embedding float[${this.embeddingDim}] distance_metric=cosine
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_meta (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        response TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        schema_fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_meta_expiry ON cache_meta(created_at, ttl_ms)');

    this.cleanupTimer = setInterval(() => this.cleanup(), this.defaultTtlMs);
  }

  async search(
    question: string,
    connectionId: string,
    schemaFingerprint: string,
  ): Promise<SemanticCacheEntry | null> {
    if (!this.enabled) return null;

    try {
      const embedding = await this.embed(question);
      const qBuf = Buffer.from(new Float32Array(embedding).buffer);

      const rows = this.db.prepare(`
        SELECT m.question, m.response, v.distance
        FROM cache_meta m
        JOIN (
          SELECT rowid, distance
          FROM vec_cache_3072
          WHERE embedding MATCH ?
            AND k = 5
        ) v ON v.rowid = m.rowid
        WHERE m.connection_id = ?
          AND m.schema_fingerprint = ?
          AND m.created_at + m.ttl_ms > ?
          AND v.distance < ?
        ORDER BY v.distance ASC
        LIMIT 1
      `).all(qBuf, connectionId, schemaFingerprint, Date.now(), 1 - this.defaultThreshold);

      if (rows.length === 0) return null;

      const row = rows[0] as { question: string; response: string; distance: number };
      return {
        question: row.question,
        distance: row.distance,
        response: JSON.parse(row.response) as AgentResponse,
      };
    } catch (error) {
      this.logger.warn(`Semantic cache search failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async store(
    question: string,
    response: AgentResponse,
    connectionId: string,
    schemaFingerprint: string,
    ttlMs?: number,
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const embedding = await this.embed(question);
      const qBuf = Buffer.from(new Float32Array(embedding).buffer);
      const ttl = ttlMs ?? this.defaultTtlMs;

      const metaResult = this.db.prepare(`
        INSERT INTO cache_meta (question, response, connection_id, schema_fingerprint, created_at, ttl_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(question, JSON.stringify(response), connectionId, schemaFingerprint, Date.now(), ttl);

      const rowid = this.db.prepare('SELECT last_insert_rowid() as rid').get() as { rid: number };
      this.db.prepare('INSERT INTO vec_cache_3072 (rowid, embedding) VALUES (?, ?)').run(BigInt(rowid.rid), qBuf);
    } catch (error) {
      this.logger.warn(`Semantic cache store failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async clear(): Promise<void> {
    if (!this.enabled) return;
    try {
      this.db.exec('DELETE FROM vec_cache_3072');
      this.db.exec('DELETE FROM cache_meta');
    } catch (error) {
      this.logger.warn(`Semantic cache clear failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:embedContent?key=${this.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.embeddingModel}`,
        content: { parts: [{ text }] },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Embedding API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as { embedding: { values: number[] } };
    return data.embedding.values;
  }

  private cleanup(): void {
    try {
      const expired = this.db.prepare('SELECT rowid FROM cache_meta WHERE created_at + ttl_ms < ?').all(Date.now()) as { rowid: number }[];
      if (expired.length === 0) return;

      const ids = expired.map(r => r.rowid);
      this.db.exec(`DELETE FROM cache_meta WHERE rowid IN (${ids.join(',')})`);
      this.db.exec(`DELETE FROM vec_cache_3072 WHERE rowid IN (${ids.join(',')})`);
      this.logger.log(`Cleaned up ${ids.length} expired semantic cache entries`);
    } catch (error) {
      this.logger.warn(`Semantic cache cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
