/**
 * Google Drive connector helpers (spec §6.1 / Phase 3).
 * Uses OAuth2 with the drive.readonly scope. Tokens are stored encrypted in the
 * connections row and refreshed lazily.
 */
import { google, type drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import {
  decryptNullable,
  encrypt,
  getAdminClient,
  optionalEnv,
  requireEnv,
  type Connection,
} from "@company-brain/shared";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    optionalEnv(
      "GOOGLE_REDIRECT_URI",
      "http://localhost:3000/api/connections/google/callback",
    ),
  );
}

/** Build an authenticated Drive client for a connection, refreshing if needed. */
export async function driveForConnection(
  connection: Connection,
): Promise<drive_v3.Drive> {
  const oauth = createOAuthClient();
  oauth.setCredentials({
    access_token: decryptNullable(connection.oauth_access_token) ?? undefined,
    refresh_token: decryptNullable(connection.oauth_refresh_token) ?? undefined,
    expiry_date: connection.oauth_expires_at
      ? new Date(connection.oauth_expires_at).getTime()
      : undefined,
  });

  // Persist refreshed access tokens back to the connection (encrypted).
  oauth.on("tokens", (tokens) => {
    void persistRefreshedTokens(connection.id, tokens);
  });

  return google.drive({ version: "v3", auth: oauth });
}

async function persistRefreshedTokens(
  connectionId: string,
  tokens: { access_token?: string | null; expiry_date?: number | null },
): Promise<void> {
  if (!tokens.access_token) return;
  const update: Record<string, unknown> = {
    oauth_access_token: encrypt(tokens.access_token),
  };
  if (tokens.expiry_date) {
    update.oauth_expires_at = new Date(tokens.expiry_date).toISOString();
  }
  await getAdminClient().from("connections").update(update).eq("id", connectionId);
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string | null;
  parents: string[];
}

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
const SUPPORTED_MIME_PREFIXES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/",
  GOOGLE_DOC_MIME,
];

function isSupported(mime: string): boolean {
  return SUPPORTED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

/** List top-level folders (used by the connect UI). */
export async function listTopLevelFolders(
  drive: drive_v3.Drive,
): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `mimeType = '${GOOGLE_FOLDER_MIME}' and 'root' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) out.push({ id: f.id, name: f.name });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/**
 * List indexable files within the included folders (recursively), excluding any
 * folders in excluded_folder_ids. Handles pagination.
 */
export async function listFilesInFolders(
  drive: drive_v3.Drive,
  includedFolderIds: string[],
  excludedFolderIds: string[] = [],
): Promise<DriveFile[]> {
  const excluded = new Set(excludedFolderIds);
  const seen = new Set<string>();
  const files: DriveFile[] = [];
  const queue = includedFolderIds.filter((id) => !excluded.has(id));

  while (queue.length > 0) {
    const folderId = queue.shift()!;
    if (seen.has(folderId)) continue;
    seen.add(folderId);

    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, parents)",
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.mimeType) continue;
        if (f.mimeType === GOOGLE_FOLDER_MIME) {
          if (!excluded.has(f.id)) queue.push(f.id);
          continue;
        }
        if (!isSupported(f.mimeType)) continue;
        files.push({
          id: f.id,
          name: f.name ?? "Untitled",
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime ?? new Date().toISOString(),
          webViewLink: f.webViewLink ?? null,
          parents: f.parents ?? [],
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return files;
}

export async function getFileMetadata(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<DriveFile> {
  const res = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, webViewLink, parents",
    supportsAllDrives: true,
  });
  const f = res.data;
  return {
    id: f.id!,
    name: f.name ?? "Untitled",
    mimeType: f.mimeType ?? "application/octet-stream",
    modifiedTime: f.modifiedTime ?? new Date().toISOString(),
    webViewLink: f.webViewLink ?? null,
    parents: f.parents ?? [],
  };
}

/**
 * Download file content. Google Docs are exported to plain text; other files
 * are downloaded as binary.
 */
export async function downloadFile(
  drive: drive_v3.Drive,
  file: DriveFile,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (file.mimeType === GOOGLE_DOC_MIME) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );
    return { buffer: Buffer.from(res.data as ArrayBuffer), mimeType: "text/plain" };
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return { buffer: Buffer.from(res.data as ArrayBuffer), mimeType: file.mimeType };
}
