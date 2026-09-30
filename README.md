# Talk to DB

Talk to DB is a full-stack AI data exploration tool that lets users ask questions about a live database in plain English. The application inspects the selected database schema, generates a read-only query, executes it through a guarded database adapter, and presents the answer with the query, result table, and optional chart.

It is designed to make database exploration accessible to people who understand the business question but do not want to write SQL or MongoDB queries by hand.

## Why This Project Matters

Traditional database tools require users to know the schema and query language before they can explore data. Talk to DB creates a guided layer between the user and the database while keeping the generated query visible and the execution bounded.

The project demonstrates how to combine:

- Natural-language AI workflows
- Schema-aware query generation
- Multiple database drivers behind one interface
- Streaming user feedback
- Read-only query safeguards
- Response caching and semantic similarity search
- A practical full-stack TypeScript architecture

## Product Capabilities

- Ask questions about PostgreSQL, MySQL, or MongoDB data in plain English.
- Configure one or multiple database connections through environment variables.
- Browse schema metadata including tables, collections, columns, keys, and row counts.
- Choose between Gemini and Groq as the AI provider, with automatic provider fallback.
- Watch agent progress as the system inspects the schema, creates a query, executes it, and writes an answer.
- Review the generated SQL or MongoDB operation instead of treating the answer as a black box.
- Inspect results in a structured table and visualize suitable results with bar or line charts.
- Use REST when Socket.IO streaming is unavailable.
- Reuse exact responses through a TTL cache and optionally reuse semantically similar responses through a local SQLite vector cache.

## How It Works

```text
User
  |
  v
Next.js chat interface (:3000)
  |  Socket.IO streaming or REST
  v
NestJS API (:3001)
  |
  +-- Agent service
  |     +-- Schema-aware prompt
  |     +-- Structured query tool
  |     +-- Gemini or Groq provider
  |     +-- Response and semantic caches
  |
  +-- Database abstraction
        +-- PostgreSQL
        +-- MySQL
        +-- MongoDB
```

For each question, the backend:

1. Resolves the active database connection.
2. Loads the database schema and caches its metadata.
3. Builds a provider-specific prompt for SQL or MongoDB.
4. Lets the model request a structured query through an agent tool.
5. Validates and executes the query through the selected database adapter.
6. Limits the result size and rejects unsupported write operations.
7. Sends the query result back to the model for a user-friendly explanation.
8. Streams the intermediate steps and final response to the frontend.

## Architecture and Engineering Decisions

### Database abstraction

PostgreSQL, MySQL, and MongoDB implement a shared `DbConnection` contract. The agent works with the contract rather than with driver-specific code, which keeps query orchestration independent from the database implementation.

### AI provider abstraction

Gemini and Groq implement the same provider-level interface. The application can select a provider explicitly or use `auto` mode to fall back when the preferred provider is unavailable.

### Guarded execution

The application applies multiple safety boundaries before returning data:

- SQL validation allows read-oriented statements and blocks write or administrative keywords.
- Result limits are configured per connection and capped by the backend.
- MongoDB supports `find` and `aggregate` operations while rejecting `$out` and `$merge` write stages.
- Database operations have execution time limits where supported.
- Agent runs have bounded attempts to avoid uncontrolled model loops.
- The README and environment configuration recommend database credentials with read-only privileges.

These controls reduce risk but do not replace database-level permissions, authentication, authorization, or request throttling.

### Caching

- Exact response caching avoids repeated AI calls for the same question, connection, and schema fingerprint.
- Schema caching reduces repeated introspection work.
- Optional semantic caching uses Gemini embeddings and `sqlite-vec` to reuse answers for closely related questions.

## Technology Stack

**Backend:** NestJS, Fastify, TypeScript, Socket.IO, Google GenAI SDK, Groq SDK, PostgreSQL `pg`, MySQL `mysql2`, MongoDB driver, `better-sqlite3`, and `sqlite-vec`.

**Frontend:** Next.js App Router, React, TypeScript, Socket.IO client, Recharts, Lucide React, and syntax highlighting.

**Communication:** REST endpoints for request/response operations and Socket.IO for streamed agent events.

## Project Structure

```text
src/
  agent/                 Agent loop, prompts, tools, providers, and caches
  chat/                  REST controller and Socket.IO gateway
  config/                Environment parsing and application settings
  database/              Connection manager, schema service, and adapters
  main.ts                NestJS application bootstrap

frontend/
  src/app/               Next.js layout, page, and global styles
  src/components/        Chat, schema, SQL, table, chart, and UI components

data/                    Local semantic-cache database, ignored by Git
```

## Requirements

- Node.js and npm
- One reachable PostgreSQL, MySQL, or MongoDB database
- At least one AI provider key:
  - `GEMINI_API_KEY`
  - `GROQ_API_KEY`

The application does not create or provision the connected database. The database and credentials must already exist.

## Quick Start

### 1. Install dependencies

Run from the repository root:

```powershell
npm install
Push-Location frontend
npm install
Pop-Location
```

### 2. Configure the backend

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Add a database connection and an AI provider key. Example for MySQL:

```env
DATABASE_URL=mysql://user:password@localhost:3306/db_agent
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```

Do not commit `.env`. If a database password contains URL-reserved characters such as `@`, `#`, `/`, or `:`, URL-encode the password before placing it in the connection URL.

### 3. Start the backend

In the first terminal:

```powershell
npm run dev
```

The backend runs at `http://localhost:3001` by default.

### 4. Start the frontend

In a second terminal:

```powershell
Push-Location frontend
npm run dev
```

Open `http://localhost:3000` in a browser. The frontend uses `http://localhost:3001` by default. To change the backend URL, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Configuration

Database configuration is resolved in this order:

```text
DATABASES JSON -> DATABASE_URL1, DATABASE_URL2, ... -> DATABASE_URL
```

### Supported database URLs

```text
postgresql://  PostgreSQL
mysql://       MySQL
mongodb://     MongoDB
```

### Multiple databases

Numbered variables are convenient for local development:

```env
DATABASE_URL1=postgresql://user:password@localhost:5432/analytics
DATABASE_URL2=mysql://user:password@localhost:3306/sales
DATABASE_URL3=mongodb://localhost:27017/catalog

DB_NAME1=Analytics DB
DB_NAME2=Sales DB
DB_NAME3=Catalog DB
DB_SCHEMA1=public
DB_SCHEMA2=sales
MAX_ROWS1=500
```

Alternatively, use a JSON array. `DATABASES` has the highest priority:

```env
DATABASES=[{"id":"sales","type":"mysql","url":"mysql://user:password@localhost:3306/sales","name":"Sales DB","maxRows":500}]
```

Each connection supports `id`, `type`, `url`, `name`, optional `schema`, and optional `maxRows`.

### Application and AI settings

```env
PORT=3001
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:3000

AI_PROVIDER=auto
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

DB_SCHEMA=public
MAX_ROWS=500
CACHE_TTL=300
CACHE_SIMILARITY_THRESHOLD=0.92
```

Provider modes:

- `gemini`: use Gemini only
- `groq`: use Groq only
- `auto`: try Gemini first, then Groq if the first provider is unavailable

Semantic caching requires `GEMINI_API_KEY` and a positive `CACHE_TTL`. Its local SQLite database is created under `data/`, which is ignored by Git.

## API Surface

The backend exposes these HTTP routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check whether the API is running |
| `GET` | `/connections` | List configured database connections |
| `GET` | `/schema` | Return schema metadata for a connection |
| `POST` | `/chat` | Run an agent question and return the response |

The Socket.IO gateway uses the `/chat` namespace and accepts the `query` event for streamed agent responses.

## Verification and Production Builds

Run backend checks from the repository root:

```powershell
npm run typecheck
npm run build
npm start
```

Run frontend checks from `frontend/`:

```powershell
npm run typecheck
npm run build
npm start
```

The production backend uses port `3001`; the production frontend uses port `3000`.
