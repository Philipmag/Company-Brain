-- ===========================================================================
-- Company Brain Lite — initial schema (spec §4)
-- Postgres + pgvector + Row-Level Security
-- ===========================================================================

create extension if not exists vector;
create extension if not exists pg_trgm; -- fuzzy text matching on knowledge_gaps

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_tier text not null default 'starter',
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- VISIBILITY GROUPS (seeded with 'all_staff' and 'leadership' per org)
-- ---------------------------------------------------------------------------
create table visibility_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(org_id, slug)
);

-- ---------------------------------------------------------------------------
-- USERS (mirrors auth.users, adds app-specific fields)
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('admin','curator','member')),
  visibility_group_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index users_org_idx on users (org_id);

-- ---------------------------------------------------------------------------
-- CONNECTIONS (one per connected source per org)
-- ---------------------------------------------------------------------------
create table connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('google_drive','slack','upload')),
  display_name text,
  oauth_access_token text,   -- encrypted via app-layer encryption
  oauth_refresh_token text,  -- encrypted
  oauth_expires_at timestamptz,
  scope_config jsonb default '{}',
  status text not null default 'pending' check (status in ('pending','syncing','active','error','disconnected')),
  last_synced_at timestamptz,
  sync_cursor text,
  error_message text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index connections_org_idx on connections (org_id);

-- ---------------------------------------------------------------------------
-- DOCUMENTS (one per source file/page/message-thread/curated answer)
-- ---------------------------------------------------------------------------
create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid references connections(id) on delete set null,
  source_type text not null check (source_type in ('google_drive','slack','upload','curated')),
  source_id text,
  title text,
  source_url text,
  content_hash text,
  visibility_group_ids uuid[] not null default '{}',
  last_modified_at timestamptz,
  last_verified_at timestamptz,
  status text not null default 'pending' check (status in ('pending','processing','indexed','error','deleted')),
  citation_count_30d int not null default 0,
  created_at timestamptz not null default now(),
  unique(connection_id, source_id)
);
create index documents_org_idx on documents (org_id);
create index documents_status_idx on documents (org_id, status);
create index documents_source_type_idx on documents (org_id, source_type);

-- ---------------------------------------------------------------------------
-- CHUNKS (one per indexed text chunk)
-- ---------------------------------------------------------------------------
create table chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  token_count int,
  chunk_index int not null default 0,
  metadata jsonb default '{}',
  visibility_group_ids uuid[] not null default '{}', -- denormalized from documents
  created_at timestamptz not null default now()
);

create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_org_idx on chunks (org_id);
create index chunks_document_idx on chunks (document_id);
create index chunks_fts_idx on chunks using gin (to_tsvector('english', content));

-- ---------------------------------------------------------------------------
-- CONVERSATIONS & MESSAGES
-- ---------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  channel text not null default 'web' check (channel in ('web','slack')),
  title text,
  created_at timestamptz not null default now()
);
create index conversations_user_idx on conversations (user_id, created_at desc);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  cited_document_ids uuid[],
  retrieval_top_score numeric,
  feedback text check (feedback in ('up','down')),
  feedback_comment text,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_org_created_idx on messages (org_id, created_at);

-- ---------------------------------------------------------------------------
-- KNOWLEDGE GAPS
-- ---------------------------------------------------------------------------
create table knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  question text not null,
  normalized_question text not null,
  frequency int not null default 1,
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  last_asked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index knowledge_gaps_norm_idx on knowledge_gaps using gin (normalized_question gin_trgm_ops);
create index knowledge_gaps_org_idx on knowledge_gaps (org_id, frequency desc);

-- ---------------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id),
  action text not null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on audit_log (org_id, created_at desc);
