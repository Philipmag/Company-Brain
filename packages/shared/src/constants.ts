/**
 * Centralised tunables. Values mirror the MVP spec (§6, §8, §9).
 */

// ---- Chunking (spec §6.1) ----
export const CHUNK_TARGET_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 75;
export const TABLE_MAX_TOKENS = 1500;

// ---- Embeddings (spec §6.1) ----
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBED_BATCH_SIZE = 100;

// ---- LLM models (spec §11 tech stack) ----
export const ANSWER_MODEL = "claude-sonnet-4-20250514";
export const REWRITE_MODEL = "claude-3-5-haiku-20241022";

// ---- Reranking (spec §6.3) ----
export const RERANK_MODEL = "rerank-english-v3.0";
export const VECTOR_SEARCH_LIMIT = 20;
export const KEYWORD_SEARCH_LIMIT = 20;
export const RERANK_TOP_N = 5;
export const RERANK_SCORE_THRESHOLD = 0.3;

// ---- Curated answers (spec §6.5) ----
export const CURATED_SIMILARITY_THRESHOLD = 0.85;

// ---- Knowledge gaps (spec §6.6) ----
export const KNOWLEDGE_GAP_SIMILARITY_THRESHOLD = 0.6;

// ---- Content health (spec §3.5 / §7) ----
export const STALE_AFTER_DAYS = 182; // ~6 months

// ---- Job retry policy (spec §6.2) ----
export const JOB_ATTEMPTS = 3;
export const JOB_BACKOFF_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

// ---- Fallback message (spec §6.4) ----
export function fallbackMessage(orgName: string): string {
  return `I couldn't find anything about that in ${orgName}'s knowledge base yet.`;
}

// ---- Sensitive folder/channel defaults (spec §3.2 / §8) ----
export const SENSITIVE_NAME_REGEX = /hr|payroll|legal|finance|salary|compensation/i;

export function isSensitiveName(name: string | null | undefined): boolean {
  if (!name) return false;
  return SENSITIVE_NAME_REGEX.test(name);
}

// ---- Plan limits (spec §8 / §9) ----
export interface PlanLimits {
  maxUsers: number;
  questionsPerMonth: number;
  questionsPerHour: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  starter: { maxUsers: 25, questionsPerMonth: 500, questionsPerHour: 100 },
  team: { maxUsers: 100, questionsPerMonth: 2000, questionsPerHour: 400 },
};

export function planLimits(tier: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[tier ?? "starter"] ?? PLAN_LIMITS.starter!;
}

// ---- Default visibility groups (spec §4) ----
export const DEFAULT_VISIBILITY_GROUPS = [
  { name: "All Staff", slug: "all_staff", is_default: true },
  { name: "Leadership", slug: "leadership", is_default: false },
] as const;
