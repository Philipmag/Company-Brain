# Company Brain Lite

Connect your **Google Drive** and **Slack**, then ask your company's knowledge
questions in plain English — get instant, **cited**, **permission-aware** answers
in a web chat and via a Slack `/ask` command.

This repository implements the MVP described in the Company Brain Lite
specification: a Next.js 14 web app + API, a BullMQ worker for ingestion, and a
Supabase (Postgres + pgvector + Auth + Storage + RLS) backend.

---

## Architecture

```
company-brain-lite/
├── apps/
│   ├── web/        Next.js 14 (App Router) — UI + API routes + SSE chat
│   └── worker/     BullMQ worker — connector sync + document ingestion pipeline
├── packages/
│   └── shared/     Shared TypeScript: types, Supabase client, embeddings,
│                   LLM/rerank wrappers, chunking, retrieval, queue defs
├── supabase/
│   └── migrations/ SQL schema, RLS policies, helper functions, storage buckets
├── docker-compose.yml   Local Redis for BullMQ
└── .env.example         Every environment variable, documented
```

**Request flow (chat):** `query rewrite (Haiku)` → `embed (OpenAI)` →
`hybrid retrieval (pgvector + Postgres FTS, visibility-filtered)` →
`rerank (Cohere)` → `curated-answer override` → `threshold check` →
`generate (Claude Sonnet, streamed via SSE)` → `parse [n] citations`.

**Ingestion flow (worker):** `sync-connection` → `process-document` (parse +
hash) → `chunk-document` (500-token chunks, 75 overlap, table-aware) →
`embed-chunks` (OpenAI batches of 100) → mark `indexed` + cleanup old chunks.

**Permissions:** every chunk carries `visibility_group_ids`. Retrieval is
filtered by the asker's groups both in SQL RPCs and via Postgres Row-Level
Security, so a user can never retrieve content outside their groups.

> See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full repository
> layout and request/ingestion flow diagrams.

## Previewing the app

```bash
pnpm preview   # boots the Next.js dev server on http://localhost:3000
```

The app boots even without real Supabase credentials (the landing/login UI
renders); sign-in and data features require the env vars described below.

---

## Prerequisites

- Node.js ≥ 20 and [pnpm](https://pnpm.io) (`corepack enable`)
- Docker (for local Redis) — or any Redis instance
- A [Supabase](https://supabase.com) project (free tier is fine)
- API keys: OpenAI, Anthropic, Cohere
- (Optional) Google Cloud OAuth credentials, a Slack app, a Stripe account

---

## 1. Install & configure

```bash
pnpm install
cp .env.example .env            # used by the worker
cp .env.example apps/web/.env.local   # used by Next.js
```

Fill in the variables in **both** files. At minimum, to run the core Q&A loop you
need: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `REDIS_URL`, and `ENCRYPTION_KEY`.

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Apply the database schema

Run the SQL files in `supabase/migrations/` **in order** against your Supabase
database (via the Supabase SQL editor, or `supabase db push` / `psql`):

1. `0001_init.sql` — tables, extensions (`vector`, `pg_trgm`), indexes (HNSW + FTS)
2. `0002_functions.sql` — RLS helpers, org seed trigger, retrieval RPCs, stats
3. `0003_rls.sql` — Row-Level Security policies
4. `0004_storage.sql` — `uploads` and `parsed-text` storage buckets

Also enable **Email** auth (and optionally **Google**) in Supabase Auth settings.

## 3. Run

```bash
pnpm redis          # start local Redis via docker-compose
pnpm dev            # Next.js app on http://localhost:3000
pnpm dev:worker     # BullMQ worker (separate terminal)
```

The web app and the worker are **separate processes** — both must run for
ingestion to work.

---

## Connector setup

### Google Drive (OAuth, read-only)

1. In [Google Cloud Console](https://console.cloud.google.com): create a project,
   enable the **Google Drive API**.
2. Create **OAuth client ID** credentials (type: Web application).
3. Add the authorized redirect URI:
   `http://localhost:3000/api/connections/google/callback`
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
5. The requested scope is `drive.readonly` only.

### Slack (`/ask` command)

1. Create a Slack app at <https://api.slack.com/apps>.
2. **OAuth & Permissions** → Bot Token Scopes:
   `commands`, `chat:write`, `users:read`, `users:read.email`, `channels:read`.
3. **Slash Commands** → create `/ask` → Request URL:
   `http://localhost:3000/api/slack/commands/ask`
4. **Interactivity & Shortcuts** → Request URL:
   `http://localhost:3000/api/slack/interactivity`
5. **Event Subscriptions** (optional, for future ingestion) → Request URL:
   `http://localhost:3000/api/slack/events`
6. Set the redirect URL `http://localhost:3000/api/connections/slack/callback`
   and fill `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.

> For local Slack testing, expose `localhost:3000` with a tunnel (e.g. `ngrok`)
> and use the public URL in the Slack app configuration.

### Stripe (optional)

Billing is **feature-flagged** off by default (`BILLING_ENABLED=false`). To
enable: set `BILLING_ENABLED=true`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_TEAM`, and point a Stripe webhook at
`/api/webhooks/stripe`.

---

## Validating against the acceptance criteria (spec §10)

1. **Signup & onboarding** — sign up at `/login`, create an org, walk the 3-step
   wizard at `/onboarding`.
2. **Drive indexing** — connect Drive, pick folders; watch documents move
   `pending → processing → indexed` in **Admin → Connectors / Overview**.
3. **Slack `/ask`** — run `/ask <question>` in the connected workspace.
4. **Cited answer** — ask about indexed content in `/chat`; the streamed answer
   shows source pills linking to the originals.
5. **Fallback + knowledge gap** — ask about something not indexed; you get the
   exact fallback string and a row appears in **Admin → Knowledge Gaps**.
6. **Permissions** — tag a doc `leadership`-only; an `all_staff`-only user cannot
   retrieve it even when relevant.
7. **Feedback** — 👍/👎 on an answer is recorded against the message.
8. **Curated answers** — write one from a knowledge gap; a matching question
   returns it marked `[Curated Answer]`.
9. **Overview stats** — document/chunk/7-day-question counts are accurate.
10. **Rate limiting** — exceed the Starter hourly limit to get a `429` with a
    friendly message.

---

## Useful commands

```bash
pnpm typecheck      # typecheck all packages
pnpm build          # build shared + web + worker
pnpm --filter @company-brain/web dev
pnpm --filter @company-brain/worker dev
```

---

## Notes & deviations from the spec

- **`cleanup-stale-chunks`** is implemented inline at the end of `embed-chunks`
  (the previous chunk generation is deleted only after the new embeddings are
  written), which achieves the spec's "no empty window" guarantee without a
  separate queue hop. A queue name is reserved should it need to be split out.
- **Slack `/ask`** answers inline within the request. Slack expects an ack within
  3 seconds; for production the generation should move to a background job that
  posts to the command's `response_url`. (Marked as a TODO.)
- **Parsed-text hand-off** between `process-document` and `chunk-document` uses a
  transient `parsed-text` storage bucket to avoid re-downloading/re-parsing.
- **Empty-state example questions** in chat are a static set (spec allows this for
  MVP; personalization from common document titles is a TODO).
- **Observability**: PostHog server-side events are wired (`lib/analytics.ts`).
  Sentry is documented via `SENTRY_DSN` but not yet initialized in code.
- Out of scope by design (per spec §12): Notion/Teams connectors, n8n workflow
  automation, meeting transcription, formal SOC2 compliance.
```
