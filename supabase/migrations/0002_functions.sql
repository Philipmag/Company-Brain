-- ===========================================================================
-- Helper functions, seed trigger, and retrieval RPCs (spec §4, §6.3, §6.6)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
create or replace function current_org_id() returns uuid as $$
  select org_id from users where id = auth.uid();
$$ language sql stable security definer;

create or replace function current_visibility_groups() returns uuid[] as $$
  select visibility_group_ids from users where id = auth.uid();
$$ language sql stable security definer;

create or replace function current_user_role() returns text as $$
  select role from users where id = auth.uid();
$$ language sql stable security definer;

-- ---------------------------------------------------------------------------
-- Seed default visibility groups when an organization is created
-- ---------------------------------------------------------------------------
create or replace function seed_default_visibility_groups()
returns trigger as $$
begin
  insert into visibility_groups (org_id, name, slug, is_default)
  values
    (new.id, 'All Staff', 'all_staff', true),
    (new.id, 'Leadership', 'leadership', false);
  return new;
end;
$$ language plpgsql security definer;

create trigger organizations_seed_groups
  after insert on organizations
  for each row execute function seed_default_visibility_groups();

-- ---------------------------------------------------------------------------
-- Keep chunks.visibility_group_ids in sync with the parent document
-- ---------------------------------------------------------------------------
create or replace function sync_chunk_visibility()
returns trigger as $$
begin
  update chunks
    set visibility_group_ids = new.visibility_group_ids
    where document_id = new.id;
  return new;
end;
$$ language plpgsql security definer;

create trigger documents_sync_chunk_visibility
  after update of visibility_group_ids on documents
  for each row execute function sync_chunk_visibility();

-- ---------------------------------------------------------------------------
-- Vector search over chunks (visibility-filtered) — spec §6.3 step 3
-- ---------------------------------------------------------------------------
create or replace function match_chunks(
  p_org_id uuid,
  p_groups uuid[],
  p_query_embedding vector(1536),
  p_limit int
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  document_title text,
  source_type text,
  source_url text,
  last_modified_at timestamptz,
  score double precision
)
language sql stable as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    d.title as document_title,
    d.source_type,
    d.source_url,
    d.last_modified_at,
    1 - (c.embedding <=> p_query_embedding) as score
  from chunks c
  join documents d on d.id = c.document_id
  where c.org_id = p_org_id
    and d.status = 'indexed'
    and d.source_type <> 'curated'
    and c.visibility_group_ids && p_groups
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Keyword (full-text) search over chunks — spec §6.3 step 3
-- ---------------------------------------------------------------------------
create or replace function keyword_search_chunks(
  p_org_id uuid,
  p_groups uuid[],
  p_query text,
  p_limit int
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  document_title text,
  source_type text,
  source_url text,
  last_modified_at timestamptz,
  score double precision
)
language sql stable as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    d.title as document_title,
    d.source_type,
    d.source_url,
    d.last_modified_at,
    ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', p_query)) as score
  from chunks c
  join documents d on d.id = c.document_id
  where c.org_id = p_org_id
    and d.status = 'indexed'
    and d.source_type <> 'curated'
    and c.visibility_group_ids && p_groups
    and to_tsvector('english', c.content) @@ websearch_to_tsquery('english', p_query)
  order by score desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Curated answer matching (cosine > threshold) — spec §6.5
-- ---------------------------------------------------------------------------
create or replace function match_curated_chunks(
  p_org_id uuid,
  p_groups uuid[],
  p_query_embedding vector(1536),
  p_threshold double precision
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  document_title text,
  source_type text,
  source_url text,
  last_modified_at timestamptz,
  score double precision
)
language sql stable as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    d.title as document_title,
    d.source_type,
    d.source_url,
    d.last_modified_at,
    1 - (c.embedding <=> p_query_embedding) as score
  from chunks c
  join documents d on d.id = c.document_id
  where c.org_id = p_org_id
    and d.source_type = 'curated'
    and d.status = 'indexed'
    and c.visibility_group_ids && p_groups
    and c.embedding is not null
    and (1 - (c.embedding <=> p_query_embedding)) > p_threshold
  order by c.embedding <=> p_query_embedding
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Knowledge-gap upsert with trigram grouping — spec §6.6
-- ---------------------------------------------------------------------------
create or replace function upsert_knowledge_gap(
  p_org_id uuid,
  p_question text,
  p_normalized text,
  p_threshold double precision
)
returns void
language plpgsql security definer as $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from knowledge_gaps
  where org_id = p_org_id
    and status <> 'dismissed'
    and similarity(normalized_question, p_normalized) > p_threshold
  order by similarity(normalized_question, p_normalized) desc
  limit 1;

  if existing_id is not null then
    update knowledge_gaps
      set frequency = frequency + 1,
          last_asked_at = now()
      where id = existing_id;
  else
    insert into knowledge_gaps (org_id, question, normalized_question)
    values (p_org_id, p_question, p_normalized);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recompute citation_count_30d from messages (scheduled daily) — spec §7
-- ---------------------------------------------------------------------------
create or replace function recompute_citation_counts()
returns void
language sql security definer as $$
  with counts as (
    select unnest(cited_document_ids) as document_id, count(*) as n
    from messages
    where role = 'assistant'
      and created_at > now() - interval '30 days'
      and cited_document_ids is not null
    group by 1
  )
  update documents d
    set citation_count_30d = coalesce(counts.n, 0)
    from (select id from documents) ids
    left join counts on counts.document_id = ids.id
    where d.id = ids.id;
$$;

-- ---------------------------------------------------------------------------
-- Overview stats (spec §3.4 Overview tab)
-- ---------------------------------------------------------------------------
create or replace function org_overview_stats(p_org_id uuid)
returns table (
  documents_indexed bigint,
  total_chunks bigint,
  questions_7d bigint
)
language sql stable as $$
  select
    (select count(*) from documents where org_id = p_org_id and status = 'indexed'),
    (select count(*) from chunks where org_id = p_org_id),
    (select count(*) from messages where org_id = p_org_id and role = 'user'
       and created_at > now() - interval '7 days');
$$;
