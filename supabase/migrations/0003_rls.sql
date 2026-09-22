-- ===========================================================================
-- Row-Level Security policies (spec §4 RLS)
-- Pattern: scope by org_id = current_org_id(); chunks/documents additionally
-- require visibility_group_ids && current_visibility_groups(). Write access is
-- role-restricted (admin/curator) per spec §11 Phase 1.
--
-- NOTE: the service-role key used by the worker bypasses RLS by design; these
-- policies protect the request-scoped (anon + user JWT) client used by the app.
-- ===========================================================================

-- ---- organizations ----
alter table organizations enable row level security;
create policy organizations_select on organizations
  for select using (id = current_org_id());
create policy organizations_update on organizations
  for update using (id = current_org_id() and current_user_role() = 'admin');

-- ---- visibility_groups ----
alter table visibility_groups enable row level security;
create policy visibility_groups_select on visibility_groups
  for select using (org_id = current_org_id());
create policy visibility_groups_write on visibility_groups
  for all using (org_id = current_org_id() and current_user_role() = 'admin')
  with check (org_id = current_org_id() and current_user_role() = 'admin');

-- ---- users ----
alter table users enable row level security;
create policy users_select on users
  for select using (org_id = current_org_id());
-- A user may update their own display_name; admins may update anyone in the org.
create policy users_update_self on users
  for update using (id = auth.uid())
  with check (id = auth.uid());
create policy users_update_admin on users
  for update using (org_id = current_org_id() and current_user_role() = 'admin')
  with check (org_id = current_org_id() and current_user_role() = 'admin');

-- ---- connections (admin only for writes) ----
alter table connections enable row level security;
create policy connections_select on connections
  for select using (org_id = current_org_id());
create policy connections_write on connections
  for all using (org_id = current_org_id() and current_user_role() = 'admin')
  with check (org_id = current_org_id() and current_user_role() = 'admin');

-- ---- documents (visibility-filtered reads; admin/curator writes) ----
alter table documents enable row level security;
create policy documents_select on documents
  for select using (
    org_id = current_org_id()
    and visibility_group_ids && current_visibility_groups()
  );
create policy documents_write on documents
  for all using (
    org_id = current_org_id() and current_user_role() in ('admin','curator')
  )
  with check (
    org_id = current_org_id() and current_user_role() in ('admin','curator')
  );

-- ---- chunks (most sensitive: visibility-filtered) ----
alter table chunks enable row level security;
create policy chunks_select on chunks
  for select using (
    org_id = current_org_id()
    and visibility_group_ids && current_visibility_groups()
  );
-- Writes to chunks happen via the service-role worker only; no anon write policy.

-- ---- conversations (owner-scoped) ----
alter table conversations enable row level security;
create policy conversations_select on conversations
  for select using (org_id = current_org_id() and user_id = auth.uid());
create policy conversations_insert on conversations
  for insert with check (org_id = current_org_id() and user_id = auth.uid());
create policy conversations_update on conversations
  for update using (org_id = current_org_id() and user_id = auth.uid());

-- ---- messages (scoped via owning conversation) ----
alter table messages enable row level security;
create policy messages_select on messages
  for select using (
    org_id = current_org_id()
    and conversation_id in (select id from conversations where user_id = auth.uid())
  );
create policy messages_insert on messages
  for insert with check (
    org_id = current_org_id()
    and conversation_id in (select id from conversations where user_id = auth.uid())
  );
-- Feedback updates allowed by the message owner.
create policy messages_update on messages
  for update using (
    org_id = current_org_id()
    and conversation_id in (select id from conversations where user_id = auth.uid())
  );

-- ---- knowledge_gaps (read all-in-org; status writes admin/curator) ----
alter table knowledge_gaps enable row level security;
create policy knowledge_gaps_select on knowledge_gaps
  for select using (org_id = current_org_id() and current_user_role() in ('admin','curator'));
create policy knowledge_gaps_write on knowledge_gaps
  for all using (org_id = current_org_id() and current_user_role() in ('admin','curator'))
  with check (org_id = current_org_id() and current_user_role() in ('admin','curator'));

-- ---- audit_log (admins read; writes via service role) ----
alter table audit_log enable row level security;
create policy audit_log_select on audit_log
  for select using (org_id = current_org_id() and current_user_role() = 'admin');
