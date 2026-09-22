/**
 * embed-chunks job (spec §6.1 step 4) + inline cleanup-stale-chunks (step 5).
 * Embeds the document's not-yet-embedded chunks in batches of <=100, marks the
 * document indexed, then deletes the previous chunk generation.
 */
import type { Job } from "bullmq";
import {
  getAdminClient,
  embedBatch,
  toPgVector,
  EMBED_BATCH_SIZE,
  type EmbedChunksJob,
} from "@company-brain/shared";

export async function handleEmbedChunks(job: Job<EmbedChunksJob>): Promise<void> {
  const supabase = getAdminClient();
  const { orgId, documentId, previousChunkIds } = job.data;

  const prevSet = new Set(previousChunkIds);

  // Select freshly-inserted chunks (no embedding yet) for this document.
  const { data: pending, error } = await supabase
    .from("chunks")
    .select("id, content")
    .eq("document_id", documentId)
    .is("embedding", null);
  if (error) throw error;

  const toEmbed = (pending ?? []).filter((c) => !prevSet.has(c.id));

  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedBatch(batch.map((c) => c.content));
    await Promise.all(
      batch.map((chunk, idx) =>
        supabase
          .from("chunks")
          .update({ embedding: toPgVector(vectors[idx]!) })
          .eq("id", chunk.id),
      ),
    );
  }

  // New chunks are embedded and live — now remove the previous generation.
  if (previousChunkIds.length > 0) {
    await supabase.from("chunks").delete().in("id", previousChunkIds);
  }

  await supabase
    .from("documents")
    .update({ status: "indexed" })
    .eq("id", documentId);

  // Clean up the transient parsed-text stash.
  await supabase.storage.from("parsed-text").remove([`${orgId}/${documentId}.txt`]);
}
