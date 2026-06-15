/**
 * Hybrid retrieval pipeline (spec §6.3 / §6.5).
 *
 * Uses the service-role client + SQL RPCs that take org_id and visibility groups
 * as explicit filters (so the same permission rules as RLS are enforced even
 * though the service-role key bypasses RLS). The web app passes the caller's
 * own org_id and visibility_group_ids — never client-supplied values that could
 * widen access.
 */
import { getAdminClient } from "./supabase";
import { embedText, toPgVector } from "./embeddings";
import { rerank } from "./rerank";
import {
  VECTOR_SEARCH_LIMIT,
  KEYWORD_SEARCH_LIMIT,
  RERANK_TOP_N,
  RERANK_SCORE_THRESHOLD,
  CURATED_SIMILARITY_THRESHOLD,
} from "./constants";
import type { RetrievedContext, SourceType } from "./types";

interface RpcChunkRow {
  chunk_id: string;
  document_id: string;
  content: string;
  document_title: string | null;
  source_type: SourceType;
  source_url: string | null;
  last_modified_at: string | null;
  score: number;
}

export interface RetrievalParams {
  orgId: string;
  visibilityGroupIds: string[];
  /** Standalone search query (post-rewrite). */
  query: string;
  /** Optional precomputed embedding to avoid a second embed call. */
  queryEmbedding?: number[];
}

export interface RetrievalResult {
  contexts: RetrievedContext[];
  topScore: number;
  belowThreshold: boolean;
  hasCurated: boolean;
}

export async function retrieveContext(
  params: RetrievalParams,
): Promise<RetrievalResult> {
  const supabase = getAdminClient();
  const embedding = params.queryEmbedding ?? (await embedText(params.query));
  const pgVector = toPgVector(embedding);

  // --- Hybrid retrieval: vector + keyword, both visibility-filtered ---
  const [vectorRes, keywordRes, curatedRes] = await Promise.all([
    supabase.rpc("match_chunks", {
      p_org_id: params.orgId,
      p_groups: params.visibilityGroupIds,
      p_query_embedding: pgVector,
      p_limit: VECTOR_SEARCH_LIMIT,
    }),
    supabase.rpc("keyword_search_chunks", {
      p_org_id: params.orgId,
      p_groups: params.visibilityGroupIds,
      p_query: params.query,
      p_limit: KEYWORD_SEARCH_LIMIT,
    }),
    supabase.rpc("match_curated_chunks", {
      p_org_id: params.orgId,
      p_groups: params.visibilityGroupIds,
      p_query_embedding: pgVector,
      p_threshold: CURATED_SIMILARITY_THRESHOLD,
    }),
  ]);

  if (vectorRes.error) throw vectorRes.error;
  if (keywordRes.error) throw keywordRes.error;
  if (curatedRes.error) throw curatedRes.error;

  // Merge + dedupe by chunk id.
  const merged = new Map<string, RpcChunkRow>();
  for (const row of (vectorRes.data ?? []) as RpcChunkRow[]) merged.set(row.chunk_id, row);
  for (const row of (keywordRes.data ?? []) as RpcChunkRow[]) {
    if (!merged.has(row.chunk_id)) merged.set(row.chunk_id, row);
  }
  const candidates = [...merged.values()];

  // --- Curated answer override (spec §6.5): highest-similarity curated chunk ---
  const curatedRows = ((curatedRes.data ?? []) as RpcChunkRow[]).sort(
    (a, b) => b.score - a.score,
  );
  const curatedTop = curatedRows[0];

  if (candidates.length === 0 && !curatedTop) {
    return { contexts: [], topScore: 0, belowThreshold: true, hasCurated: false };
  }

  // --- Rerank candidates (spec §6.3 step 4) ---
  let reranked: RetrievedContext[] = [];
  let topScore = 0;
  if (candidates.length > 0) {
    const docs = candidates.map((c) => c.content);
    const results = await rerank(params.query, docs, RERANK_TOP_N);
    reranked = results.map((r) => toContext(candidates[r.index]!, r.relevanceScore, false));
    topScore = results[0]?.relevanceScore ?? 0;
  }

  // If a curated answer matched strongly, inject it as context item [1].
  let contexts = reranked;
  let hasCurated = false;
  if (curatedTop) {
    const curatedCtx = toContext(curatedTop, curatedTop.score, true);
    // Remove duplicate if the same chunk also surfaced in rerank.
    contexts = [curatedCtx, ...reranked.filter((c) => c.chunkId !== curatedCtx.chunkId)].slice(
      0,
      RERANK_TOP_N,
    );
    hasCurated = true;
    // A curated match always clears the threshold.
    topScore = Math.max(topScore, curatedTop.score);
  }

  const belowThreshold = !hasCurated && topScore < RERANK_SCORE_THRESHOLD;

  return { contexts, topScore, belowThreshold, hasCurated };
}

function toContext(row: RpcChunkRow, score: number, isCurated: boolean): RetrievedContext {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title ?? "Untitled",
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    lastModifiedAt: row.last_modified_at,
    content: row.content,
    score,
    isCurated,
  };
}

/** Normalize a question for knowledge-gap grouping (spec §6.6). */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse [1], [2] citation markers from an answer and map to document ids.
 * `contexts` is the ordered list passed to the prompt (1-indexed).
 */
export function extractCitedDocumentIds(
  answer: string,
  contexts: RetrievedContext[],
): string[] {
  const ids = new Set<string>();
  const matches = answer.matchAll(/\[(\d+)\]/g);
  for (const m of matches) {
    const n = Number(m[1]);
    const ctx = contexts[n - 1];
    if (ctx) ids.add(ctx.documentId);
  }
  return [...ids];
}
