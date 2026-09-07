import { DbConnectionConfig } from '../database/connections/connection.interface';

export type AiProviderMode = 'auto' | 'gemini' | 'groq';

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProvider(value: string | undefined): AiProviderMode {
  if (value === 'gemini' || value === 'groq' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function detectType(url: string): 'postgres' | 'mysql' | 'mongodb' {
  return url.startsWith('mysql') ? 'mysql'
    : url.startsWith('mongodb') ? 'mongodb'
    : 'postgres';
}

function extractDbName(url: string): string {
  const match = url.match(/\/([^/?]+)(?:\?|$)/);
  return match ? match[1] : 'database';
}

function connectionFromUrl(
  url: string,
  id: string,
  name: string,
  schemaFallback: string,
  maxRowsFallback: number,
): DbConnectionConfig {
  const type = detectType(url);
  return {
    id,
    type,
    url,
    name,
    schema: type === 'mongodb' ? undefined : schemaFallback,
    maxRows: maxRowsFallback,
  };
}

function parseDatabases(): DbConnectionConfig[] {
  const databasesJson = process.env.DATABASES;
  if (databasesJson) {
    try {
      const parsed = JSON.parse(databasesJson) as DbConnectionConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to legacy DATABASE_URL
    }
  }

  const schemaFallback = process.env.DB_SCHEMA ?? 'public';
  const maxRowsFallback = parseInteger(process.env.MAX_ROWS, 500);

  // Option B: Numbered env vars DATABASE_URL1, DATABASE_URL2, ...
  const numberedConns: DbConnectionConfig[] = [];
  for (let i = 1; i <= 100; i++) {
    const url = process.env[`DATABASE_URL${i}`];
    if (!url) continue;
    const name = process.env[`DB_NAME${i}`] ?? extractDbName(url);
    const schema = process.env[`DB_SCHEMA${i}`] ?? schemaFallback;
    const maxRows = parseInteger(process.env[`MAX_ROWS${i}`] as string | undefined, maxRowsFallback);
    numberedConns.push(connectionFromUrl(url, `db${i}`, name, schema, maxRows));
  }
  if (numberedConns.length > 0) return numberedConns;

  // Option C: Single legacy DATABASE_URL
  const legacyUrl = process.env.DATABASE_URL ?? '';
  if (legacyUrl) {
    return [connectionFromUrl(legacyUrl, 'default', extractDbName(legacyUrl), schemaFallback, maxRowsFallback)];
  }

  return [];
}

export default () => ({
  port: parseInteger(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  databases: parseDatabases(),
  cacheTtl: parseInteger(process.env.CACHE_TTL, 300),
  cacheSimilarityThreshold: (() => {
    const v = Number.parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD ?? '0.92');
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.92;
  })(),
  ai: {
    provider: parseProvider(process.env.AI_PROVIDER),
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
    geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    groqApiKey: process.env.GROQ_API_KEY ?? '',
    groqModel: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
  },
});
