/**
 * OpenAI embeddings (text-embedding-3-small, 1536 dims) — spec §6.1.
 */
import OpenAI from "openai";
import { env } from "./env";
import { EMBEDDING_MODEL, EMBED_BATCH_SIZE } from "./constants";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  if (!vector) throw new Error("Embedding returned no vector");
  return vector;
}

/**
 * Embed a list of texts, batching to at most EMBED_BATCH_SIZE per request.
 * Returns vectors in the same order as the input.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const res = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    // OpenAI preserves input order in `data` but sort by index to be safe.
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) out.push(item.embedding);
  }
  return out;
}

/** pgvector accepts a string like "[0.1,0.2,...]". */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
