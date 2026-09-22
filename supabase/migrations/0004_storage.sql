-- ===========================================================================
-- Storage buckets used by the ingestion pipeline (spec §6.1 / Phase 4)
--   uploads      — original files uploaded via /api/documents/upload
--   parsed-text  — transient parsed plaintext handed from process-document to
--                  chunk-document, deleted after embedding
-- Both are private; access happens via the service-role worker only.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values
  ('uploads', 'uploads', false),
  ('parsed-text', 'parsed-text', false)
on conflict (id) do nothing;
