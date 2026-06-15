/**
 * Cohere Rerank (rerank-english-v3.0) — spec §6.3 step 4.
 */
import { CohereClient } from "cohere-ai";
import { env } from "./env";
import { RERANK_MODEL, RERANK_TOP_N } from "./constants";

let client: CohereClient | null = null;

function getClient(): CohereClient {
  if (!client) client = new CohereClient({ token: env.cohereApiKey });
  return client;
}

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

/**
 * Rerank `documents` against `query`, returning the top N entries with their
 * relevance scores (0–1), ordered most-relevant first.
 */
export async function rerank(
  query: string,
  documents: string[],
  topN: number = RERANK_TOP_N,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  const res = await getClient().rerank({
    model: RERANK_MODEL,
    query,
    documents,
    topN: Math.min(topN, documents.length),
  });
  return res.results.map((r) => ({
    index: r.index,
    relevanceScore: r.relevanceScore,
  }));
}
