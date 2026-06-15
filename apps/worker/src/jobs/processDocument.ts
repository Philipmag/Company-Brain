/**
 * process-document job (spec §6.1 step 2).
 * Downloads content, parses it, computes a content hash, upserts the documents
 * row, and enqueues chunk-document. Skips re-chunking if the hash is unchanged.
 */
import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import {
  getAdminClient,
  enqueueChunkDocument,
  writeAudit,
  type Connection,
  type Document,
  type ProcessDocumentJob,
} from "@company-brain/shared";
import {
  driveForConnection,
  downloadFile,
  getFileMetadata,
  type DriveFile,
} from "../connectors/googleDrive.js";
import { parseDocument } from "../parser.js";

const UPLOAD_BUCKET = "uploads";

export async function handleProcessDocument(
  job: Job<ProcessDocumentJob>,
): Promise<void> {
  const supabase = getAdminClient();
  const { orgId, connectionId, sourceRef, sourceType } = job.data;

  let buffer: Buffer;
  let mimeType: string | null;
  let fileName: string | null;
  let title: string;
  let sourceUrl: string | null;
  let lastModified: string;
  let documentId = job.data.documentId ?? null;
  let visibilityGroupIds: string[] = [];

  if (sourceType === "google_drive") {
    if (!connectionId) throw new Error("google_drive process requires connectionId");
    const { data: connection } = await supabase
      .from("connections")
      .select("*")
      .eq("id", connectionId)
      .single<Connection>();
    if (!connection) throw new Error(`Connection ${connectionId} not found`);

    const drive = await driveForConnection(connection);
    const meta: DriveFile = await getFileMetadata(drive, sourceRef);
    const downloaded = await downloadFile(drive, meta);
    buffer = downloaded.buffer;
    mimeType = downloaded.mimeType;
    fileName = meta.name;
    title = meta.name;
    sourceUrl = meta.webViewLink;
    lastModified = meta.modifiedTime;
    visibilityGroupIds = await defaultVisibilityGroupIds(orgId);
  } else if (sourceType === "upload") {
    if (!documentId) throw new Error("upload process requires documentId");
    const { data: doc } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single<Document>();
    if (!doc) throw new Error(`Document ${documentId} not found`);

    const { data: file, error: dlErr } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .download(sourceRef);
    if (dlErr || !file) throw new Error(`Storage download failed: ${dlErr?.message}`);
    buffer = Buffer.from(await file.arrayBuffer());
    mimeType = file.type || null;
    fileName = doc.title;
    title = doc.title ?? "Untitled";
    sourceUrl = doc.source_url;
    lastModified = doc.last_modified_at ?? new Date().toISOString();
    visibilityGroupIds = doc.visibility_group_ids;
  } else {
    throw new Error(`Unsupported source type ${sourceType}`);
  }

  const { text } = await parseDocument({ buffer, mimeType, fileName });
  const contentHash = createHash("sha256").update(text).digest("hex");

  // Upsert the documents row.
  if (documentId) {
    const { data: existing } = await supabase
      .from("documents")
      .select("content_hash")
      .eq("id", documentId)
      .single<{ content_hash: string | null }>();
    if (existing?.content_hash === contentHash) {
      await supabase.from("documents").update({ status: "indexed" }).eq("id", documentId);
      return; // unchanged — skip re-chunking
    }
    await supabase
      .from("documents")
      .update({
        status: "processing",
        content_hash: contentHash,
        last_modified_at: lastModified,
        title,
        source_url: sourceUrl,
      })
      .eq("id", documentId);
  } else {
    // Drive: upsert by (connection_id, source_id).
    const { data: existing } = await supabase
      .from("documents")
      .select("id, content_hash")
      .eq("connection_id", connectionId)
      .eq("source_id", sourceRef)
      .maybeSingle<{ id: string; content_hash: string | null }>();

    if (existing) {
      documentId = existing.id;
      if (existing.content_hash === contentHash) {
        await supabase.from("documents").update({ status: "indexed" }).eq("id", documentId);
        return;
      }
      await supabase
        .from("documents")
        .update({
          status: "processing",
          content_hash: contentHash,
          last_modified_at: lastModified,
          title,
          source_url: sourceUrl,
        })
        .eq("id", documentId);
    } else {
      const { data: inserted, error } = await supabase
        .from("documents")
        .insert({
          org_id: orgId,
          connection_id: connectionId,
          source_type: sourceType,
          source_id: sourceRef,
          title,
          source_url: sourceUrl,
          content_hash: contentHash,
          visibility_group_ids: visibilityGroupIds,
          last_modified_at: lastModified,
          status: "processing",
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !inserted) throw error ?? new Error("Failed to insert document");
      documentId = inserted.id;
    }
  }

  // Stash parsed text for the chunking job via a transient storage location.
  await stashText(orgId, documentId, text);
  await enqueueChunkDocument({ orgId, documentId });
}

/** Default to the org's default visibility group(s). */
async function defaultVisibilityGroupIds(orgId: string): Promise<string[]> {
  const { data } = await getAdminClient()
    .from("visibility_groups")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true);
  return (data ?? []).map((g) => g.id);
}

/**
 * Parsed text can be large; persist it to Storage so the chunk job can read it
 * without re-downloading/parsing the source.
 */
async function stashText(orgId: string, documentId: string, text: string): Promise<void> {
  const supabase = getAdminClient();
  const path = `${orgId}/${documentId}.txt`;
  await supabase.storage
    .from("parsed-text")
    .upload(path, new Blob([text], { type: "text/plain" }), { upsert: true });
}
