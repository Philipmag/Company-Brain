/**
 * chunk-document job (spec §6.1 step 3).
 * Reads the parsed text, chunks it, and enqueues embed-chunks. Records the
 * previous chunk ids so embed-chunks can clean them up after success.
 */
import type { Job } from "bullmq";
import {
  getAdminClient,
  enqueueEmbedChunks,
  chunkText,
  type ChunkDocumentJob,
} from "@company-brain/shared";

interface PendingChunk {
  document_id: string;
  org_id: string;
  content: string;
  token_count: number;
  chunk_index: number;
  metadata: Record<string, unknown>;
  visibility_group_ids: string[];
}

export async function handleChunkDocument(job: Job<ChunkDocumentJob>): Promise<void> {
  const supabase = getAdminClient();
  const { orgId, documentId } = job.data;

  const { data: doc } = await supabase
    .from("documents")
    .select("id, visibility_group_ids")
    .eq("id", documentId)
    .single<{ id: string; visibility_group_ids: string[] }>();
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const text = await readStashedText(orgId, documentId);
  if (!text || text.trim().length === 0) {
    await supabase.from("documents").update({ status: "indexed" }).eq("id", documentId);
    return;
  }

  const chunks = chunkText(text);

  // Record existing chunk ids to delete after the new ones are written.
  const { data: previous } = await supabase
    .from("chunks")
    .select("id")
    .eq("document_id", documentId);
  const previousChunkIds = (previous ?? []).map((c) => c.id);

  // Insert new chunks (embeddings filled by embed-chunks). Tag with a temporary
  // marker via chunk_index offset is unnecessary; embed-chunks reads NULL-embedding rows.
  const rows: PendingChunk[] = chunks.map((c) => ({
    document_id: documentId,
    org_id: orgId,
    content: c.content,
    token_count: c.tokenCount,
    chunk_index: c.chunkIndex,
    metadata: c.metadata,
    visibility_group_ids: doc.visibility_group_ids,
  }));

  // Insert without embeddings; embed-chunks will backfill them, then delete the
  // previous generation (cleanup-stale-chunks pattern, §6.1 step 5).
  if (rows.length > 0) {
    const { error } = await supabase.from("chunks").insert(rows);
    if (error) throw error;
  }

  await enqueueEmbedChunks({ orgId, documentId, previousChunkIds });
}

async function readStashedText(orgId: string, documentId: string): Promise<string> {
  const supabase = getAdminClient();
  const path = `${orgId}/${documentId}.txt`;
  const { data, error } = await supabase.storage.from("parsed-text").download(path);
  if (error || !data) throw new Error(`Could not read parsed text for ${documentId}`);
  return await data.text();
}
