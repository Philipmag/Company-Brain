import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/api";
import { createOAuthClient, DRIVE_SCOPE } from "@/lib/connectors/google";

/** Begin the Google Drive OAuth flow (admin only). Returns the consent URL. */
export async function POST() {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const oauth = createOAuthClient();
    const url = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [DRIVE_SCOPE],
      // Carry the org id so the callback can attribute the connection.
      state: org.id,
    });
    return json({ url });
  });
}
