# Architecture

Company Brain Lite is a pnpm monorepo with three deployable/importable units and
a SQL-defined backend.

## Repository layout

```
company-brain-lite/
├── apps/
│   ├── web/                  Next.js 14 (App Router)
│   │   └── src/
│   │       ├── app/          Pages + API route handlers
│   │       │   ├── api/      REST + SSE endpoints (grouped by domain)
│   │       │   ├── admin/    Admin dashboard page
│   │       │   ├── chat/     Chat page
│   │       │   ├── login/    Auth
│   │       │   └── onboarding/
│   │       ├── components/    React components
│   │       │   ├── admin/    Dashboard tabs + modals
│   │       │   ├── chat/     Chat client
│   │       │   └── ui/       shadcn-style primitives
│   │       └── lib/          Client/server helpers
│   │           ├── connectors/  Google + Slack helpers
│   │           └── supabase/    SSR + browser clients, middleware
│   └── worker/               BullMQ worker
│       └── src/
│           ├── connectors/   Google Drive client
│           ├── jobs/         sync/process/chunk/embed handlers
│           └── parser.ts     Pluggable DocumentParser
├── packages/
│   └── shared/               Types, Supabase admin client, embeddings, LLM,
│                             rerank, chunking, retrieval, queue definitions
├── supabase/
│   └── migrations/           0001 schema · 0002 functions/RPCs · 0003 RLS ·
│                             0004 storage buckets
├── docs/                     This document
└── docker-compose.yml        Local Redis for BullMQ
```

## Chat request flow (`POST /api/chat/message`)

```
question
  → query rewrite (Claude Haiku, skipped on first message)
  → embed query (OpenAI text-embedding-3-small)
  → hybrid retrieval (pgvector cosine + Postgres FTS, visibility-filtered RPCs)
  → rerank (Cohere rerank-english-v3.0, top 5)
  → curated-answer override (cosine > 0.85 → context item [1])
  → threshold check (top score < 0.3 → exact fallback + knowledge_gaps upsert)
  → generate (Claude Sonnet, streamed over Server-Sent Events)
  → parse [n] citation markers → messages.cited_document_ids
```

## Ingestion flow (worker)

```
sync-connection   list changed Drive files → enqueue process-document
process-document  download + parse + content_hash (skip if unchanged) → chunk-document
chunk-document    500-token chunks, 75 overlap, heading/paragraph/table-aware → embed-chunks
embed-chunks      OpenAI embeddings (batches of 100) → mark indexed → delete old chunks
```

Retries follow the spec's 3-attempt exponential backoff (1m / 5m / 30m); final
failures set `status = 'error'` and write to `audit_log`.

## Permissions

Every `chunks` row carries denormalized `visibility_group_ids`. Retrieval is
filtered by the asker's groups in the SQL RPCs **and** by Row-Level Security, so
a user can never retrieve content outside their visibility groups.
