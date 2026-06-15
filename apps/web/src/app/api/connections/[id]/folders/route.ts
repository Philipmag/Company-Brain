import { type NextRequest } from "next/server";
import {
  getAdminClient,
  decryptNullable,
  isSensitiveName,
  type Connection,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";
import { createOAuthClient, driveFor } from "@/lib/connectors/google";

/**
 * List top-level Drive folders for the folder-selection UI (spec §3.2 / Phase 3).
 * Folders whose names look sensitive default to unchecked.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const admin = getAdminClient();
    const { data: connection } = await admin
      .from("connections")
      .select("*")
      .eq("id", params.id)
      .eq("org_id", org.id)
      .single<Connection>();
    if (!connection) return errorJson("Connection not found", 404);
    if (connection.provider !== "google_drive") {
      return errorJson("Not a Google Drive connection", 400);
    }

    const oauth = createOAuthClient();
    oauth.setCredentials({
      access_token: decryptNullable(connection.oauth_access_token) ?? undefined,
      refresh_token: decryptNullable(connection.oauth_refresh_token) ?? undefined,
    });
    const drive = driveFor(oauth);

    const res = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false",
      fields: "files(id, name)",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const folders = (res.data.files ?? []).map((f) => ({
      id: f.id!,
      name: f.name ?? "Untitled",
      // Safety default: sensitive-looking folders start unchecked (spec §8).
      defaultSelected: !isSensitiveName(f.name),
      sensitive: isSensitiveName(f.name),
    }));

    return json({ folders });
  });
}
