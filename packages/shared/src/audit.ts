/**
 * Audit logging + knowledge-gap upsert helpers (spec §6.6 / §8).
 */
import { getAdminClient } from "./supabase.js";
import { normalizeQuestion } from "./retrieval.js";
import { KNOWLEDGE_GAP_SIMILARITY_THRESHOLD } from "./constants.js";

export async function writeAudit(
  orgId: string,
  action: string,
  metadata: Record<string, unknown> = {},
  userId?: string | null,
): Promise<void> {
  try {
    await getAdminClient()
      .from("audit_log")
      .insert({ org_id: orgId, user_id: userId ?? null, action, metadata });
  } catch {
    // Audit failures must never break the request path.
  }
}

/**
 * Upsert a knowledge gap. If a row with a trigram-similar normalized_question
 * exists, increment its frequency; otherwise insert a new row (spec §6.6).
 * Implemented via the `upsert_knowledge_gap` SQL function.
 */
export async function upsertKnowledgeGap(
  orgId: string,
  question: string,
): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.rpc("upsert_knowledge_gap", {
    p_org_id: orgId,
    p_question: question,
    p_normalized: normalizeQuestion(question),
    p_threshold: KNOWLEDGE_GAP_SIMILARITY_THRESHOLD,
  });
  if (error) throw error;
}
