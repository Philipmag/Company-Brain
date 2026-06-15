/**
 * sync-connection job (spec §6.1 step 1).
 * Lists changed/new files in the connection's selected folders and enqueues
 * process-document for each. Currently implements the Google Drive provider;
 * Slack channel ingestion is Phase 2 (scope reserved in the schema).
 */
import type { Job } from "bullmq";
import {
  getAdminClient,
  enqueueProcessDocument,
  writeAudit,
  type Connection,
  type SyncConnectionJob,
} from "@company-brain/shared";
import {
  driveForConnection,
  listFilesInFolders,
} from "../connectors/googleDrive.js";

export async function handleSyncConnection(
  job: Job<SyncConnectionJob>,
): Promise<void> {
  const { connectionId, orgId } = job.data;
  const supabase = getAdminClient();

  const { data: connection, error } = await supabase
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .single<Connection>();
  if (error || !connection) throw new Error(`Connection ${connectionId} not found`);

  await supabase
    .from("connections")
    .update({ status: "syncing", error_message: null })
    .eq("id", connectionId);

  try {
    if (connection.provider === "google_drive") {
      await syncGoogleDrive(connection);
    } else {
      // Slack/upload do not use scheduled sync in the MVP.
      throw new Error(`Sync not supported for provider ${connection.provider}`);
    }

    await supabase
      .from("connections")
      .update({ status: "active", last_synced_at: new Date().toISOString() })
      .eq("id", connectionId);
    await writeAudit(orgId, "connector.synced", { connectionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only flip to error status after exhausting retries.
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await supabase
        .from("connections")
        .update({ status: "error", error_message: message })
        .eq("id", connectionId);
      await writeAudit(orgId, "connector.sync_failed", { connectionId, message });
    }
    throw err;
  }
}

async function syncGoogleDrive(connection: Connection): Promise<void> {
  const supabase = getAdminClient();
  const drive = await driveForConnection(connection);
  const included = connection.scope_config?.included_folder_ids ?? [];
  const excluded = connection.scope_config?.excluded_folder_ids ?? [];
  if (included.length === 0) return;

  const files = await listFilesInFolders(drive, included, excluded);

  // Compare against existing documents to skip unchanged files.
  const { data: existing } = await supabase
    .from("documents")
    .select("source_id, last_modified_at")
    .eq("connection_id", connection.id);
  const existingMap = new Map(
    (existing ?? []).map((d) => [d.source_id, d.last_modified_at]),
  );

  for (const file of files) {
    const prevModified = existingMap.get(file.id);
    const changed =
      !prevModified ||
      new Date(file.modifiedTime).getTime() > new Date(prevModified).getTime();
    if (!changed) continue;

    await enqueueProcessDocument({
      orgId: connection.org_id,
      connectionId: connection.id,
      sourceRef: file.id,
      sourceType: "google_drive",
    });
  }
}
