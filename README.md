# Talk_to_DB

Talk_to_DB is a full-stack natural-language database assistant. A user asks a question in plain English, and the application uses the selected database schema to generate and execute a read-only SQL or MongoDB query. The result is returned as a clear answer with the generated query, table data, and an optional chart.

The application supports PostgreSQL, MySQL, and MongoDB. Multiple connections can be configured at the same time and selected from the frontend.

## Features

- Natural-language questions over relational and MongoDB data
- PostgreSQL, MySQL, and MongoDB support
- Multiple database connections with runtime selection
- Schema introspection with table, column, key, and row-count metadata
- Gemini and Groq provider support with optional fallback
- Tool-based agent loop for query execution and answer generation
- Read-only SQL enforcement and automatic result limits
- MongoDB `find` and `aggregate` query support
- Streaming agent steps over Socket.IO
- REST fallback when WebSocket streaming is unavailable
- SQL/JSON display, result tables, and bar or line charts
- Exact response caching and optional semantic caching with SQLite vector search

## Architecture

The repository contains two applications:

```text
Browser
  |
  +-- Next.js frontend :3000
          |
          +-- Socket.IO / REST
                  |
                  +-- NestJS backend :3001
                          |
                          +-- Agent service
                          +-- Schema service
                          +-- Database connections
                          +-- Gemini or Groq
```

For each question, the backend:

1. Resolves the selected database connection.
2. Loads and caches its schema.
3. Builds a prompt for SQL or MongoDB.
4. Lets the AI request a query through a structured tool.
5. Validates and executes the query through the database abstraction.
6. Sends the result back to the AI for a final answer.
7. Streams the agent steps and final response to the frontend.

The database layer uses a shared `DbConnection` abstraction, so the agent does not depend on a specific database driver. The provider layer gives Gemini and Groq the same application-level contract.

## Engineering Highlights

- **Provider abstraction:** Gemini and Groq share one tool-call interface, allowing the agent loop to switch providers without changing database code.
- **Database abstraction:** PostgreSQL, MySQL, and MongoDB implement the same connection contract for schema discovery and query execution.
- **Guarded execution:** SQL is restricted to read queries, result limits are enforced, MongoDB write aggregation stages are rejected, and each agent run has bounded query attempts.
- **Useful feedback:** Agent steps stream to the UI over Socket.IO, with a REST path when a socket is unavailable.
- **Performance:** Schema metadata and successful responses are cached; semantic caching can reuse answers to closely related questions.

This is a portfolio project and local prototype. It does not include user authentication or tenant isolation, so it should only be exposed in a trusted environment. For any deployment with untrusted users, add authentication, authorization per connection, request throttling, and server-side query cancellation. Configure database credentials with read-only privileges as an additional safety boundary.

## Current Limitations

- Semantic caching requires a Gemini API key, even when Groq is the primary answer provider.
- MongoDB schema fields are inferred from a small sample of documents and may not represent every document shape.
- Database connections are loaded at startup from environment configuration; users cannot add connections through the UI.
- Query safety checks are defense in depth, not a replacement for database-level read-only credentials.
- There is no built-in login, user management, or deployment configuration for a public multi-user service.

## Portfolio Walkthrough

When presenting this project, connect a sample database, ask a question that needs a join or aggregation, then show the generated query, bounded result table, and chart. Explain the provider and database interfaces, and discuss the security trade-offs of executing model-generated queries. A short screen recording and screenshots of the connected and result states make the repository easier to evaluate.

## Stack

**Backend:** NestJS, Fastify, TypeScript, Socket.IO, `pg`, `mysql2`, MongoDB driver, `better-sqlite3`, and `sqlite-vec`.

**Frontend:** Next.js App Router, React, TypeScript, Socket.IO client, Recharts, Lucide, and syntax highlighting.

## Requirements

- Node.js and npm
- One reachable PostgreSQL, MySQL, or MongoDB database
- At least one AI provider key:
  - `GEMINI_API_KEY`, or
  - `GROQ_API_KEY`

The application does not create the application database. The configured database and its credentials must already exist.

## Quick Start

### 1. Install dependencies

From the repository root:

```powershell
npm install
cd frontend
npm install
cd ..
```

### 2. Create the backend environment file

```powershell
copy .env.example .env
```

Edit `.env` and add at least one database connection and one AI provider key. For a local MySQL database named `db_agent`:

```env
DATABASE_URL=mysql://user:password@localhost:3306/db_agent
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```

If a password contains URL-reserved characters such as `@`, `#`, `/`, or `:`, URL-encode it.

### 3. Start the backend

In one terminal:

```powershell
npm run start:dev
```

The backend listens on `http://localhost:3001` by default.

### 4. Start the frontend

In a second terminal:

```powershell
cd frontend
npm run dev
```

Open `http://localhost:3000`.

The frontend defaults to `http://localhost:3001` for the backend. To change it, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Configuration

Database configuration is read in this order:

```text
DATABASES JSON -> DATABASE_URL1, DATABASE_URL2, ... -> DATABASE_URL
```

### Single database

```env
DATABASE_URL=postgresql://user:password@localhost:5432/analytics
```

The URL prefix determines the database type:

```text
postgresql://  PostgreSQL
mysql://       MySQL
mongodb://     MongoDB
```

### Multiple databases

Numbered variables are the simplest option:

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

Provider modes are:

- `gemini`: use Gemini only
- `groq`: use Groq only
- `auto`: try Gemini first, then Groq if the first provider fails

Semantic caching is enabled only when `GEMINI_API_KEY` is available and `CACHE_TTL` is greater than zero. Its local SQLite file is created under `data/` and is ignored by Git.

## Project Structure

```text
src/
  agent/              AI providers, tools, prompts, and agent loop
  chat/               REST controller and Socket.IO gateway
  config/             Environment configuration
  database/           Connection manager, schema service, and drivers
  main.ts             NestJS application bootstrap

frontend/
  src/app/            Next.js layout and chat page
  src/components/     Schema, chat, SQL, table, and chart components
```

## Verification and Production Builds

Backend:

```powershell
npm run typecheck
npm run build
npm start
```

Frontend:

```powershell
cd frontend
npm run typecheck
npm run build
npm start
```

The backend production process uses port `3001`; the frontend production process uses port `3000`.
