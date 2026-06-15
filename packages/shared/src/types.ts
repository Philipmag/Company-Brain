/**
 * Domain types mirroring the Postgres schema (spec §4).
 * These are hand-written to keep the build dependency-free; they can be replaced
 * by `supabase gen types typescript` output later.
 */

export type UserRole = "admin" | "curator" | "member";
export type ConnectorProvider = "google_drive" | "slack" | "upload";
export type SourceType = "google_drive" | "slack" | "upload" | "curated";
export type ConnectionStatus =
  | "pending"
  | "syncing"
  | "active"
  | "error"
  | "disconnected";
export type DocumentStatus =
  | "pending"
  | "processing"
  | "indexed"
  | "error"
  | "deleted";
export type ConversationChannel = "web" | "slack";
export type MessageRole = "user" | "assistant";
export type Feedback = "up" | "down";
export type KnowledgeGapStatus = "open" | "answered" | "dismissed";

export interface Organization {
  id: string;
  name: string;
  plan_tier: string;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface VisibilityGroup {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  is_default: boolean;
  created_at: string;
}

export interface AppUser {
  id: string;
  org_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  visibility_group_ids: string[];
  created_at: string;
}

export interface ScopeConfig {
  included_folder_ids?: string[];
  excluded_folder_ids?: string[];
  included_channel_ids?: string[];
  excluded_channel_ids?: string[];
  team_id?: string;
  team_name?: string;
  bot_user_id?: string;
}

export interface Connection {
  id: string;
  org_id: string;
  provider: ConnectorProvider;
  display_name: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  scope_config: ScopeConfig;
  status: ConnectionStatus;
  last_synced_at: string | null;
  sync_cursor: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  org_id: string;
  connection_id: string | null;
  source_type: SourceType;
  source_id: string | null;
  title: string | null;
  source_url: string | null;
  content_hash: string | null;
  visibility_group_ids: string[];
  last_modified_at: string | null;
  last_verified_at: string | null;
  status: DocumentStatus;
  citation_count_30d: number;
  created_at: string;
}

export interface Chunk {
  id: string;
  org_id: string;
  document_id: string;
  content: string;
  embedding: number[] | null;
  token_count: number | null;
  chunk_index: number;
  metadata: Record<string, unknown>;
  visibility_group_ids: string[];
  created_at: string;
}

export interface Conversation {
  id: string;
  org_id: string;
  user_id: string;
  channel: ConversationChannel;
  title: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  org_id: string;
  role: MessageRole;
  content: string;
  cited_document_ids: string[] | null;
  retrieval_top_score: number | null;
  feedback: Feedback | null;
  feedback_comment: string | null;
  created_at: string;
}

export interface KnowledgeGap {
  id: string;
  org_id: string;
  question: string;
  normalized_question: string;
  frequency: number;
  status: KnowledgeGapStatus;
  last_asked_at: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** A retrieved + reranked context item used to build the answer prompt. */
export interface RetrievedContext {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  lastModifiedAt: string | null;
  content: string;
  score: number;
  isCurated: boolean;
}
