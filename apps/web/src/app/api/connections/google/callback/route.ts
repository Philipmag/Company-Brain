import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminClient,
  encryptNullable,
  writeAudit,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { createOAuthClient } from "@/lib/connectors/google";
import { captureEvent } from "@/lib/analytics";

/**
 * Google Drive OAuth callback (spec §5). Exchanges the code for tokens, stores
 * them encrypted, and creates a connections row in 'pending' status. Folder
 * selection happens next via the onboarding UI -> PATCH /api/connections/:id.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  if (error || !code) {
    return NextResponse.redirect(`${origin}/onboarding?step=drive&error=oauth`);
  }

  let session;
  try {
    session = await requireRole(["admin"]);
  } catch {
    return NextResponse.redirect(`${origin}/login`);
  }

  try {
    const oauth = createOAuthClient();
    const { tokens } = await oauth.getToken(code);

    const admin = getAdminClient();
    const { data: connection, error: insertErr } = await admin
      .from("connections")
      .insert({
        org_id: session.org.id,
        provider: "google_drive",
        display_name: "Google Drive",
        oauth_access_token: encryptNullable(tokens.access_token),
        oauth_refresh_token: encryptNullable(tokens.refresh_token),
        oauth_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        scope_config: {},
        status: "pending",
        created_by: session.user.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (insertErr || !connection) throw insertErr ?? new Error("insert failed");

    await writeAudit(session.org.id, "connector.connected", {
      provider: "google_drive",
      connectionId: connection.id,
    });
    await captureEvent("connector_connected", session.user.id, {
      provider: "google_drive",
    });

    return NextResponse.redirect(
      `${origin}/onboarding?step=drive&connectionId=${connection.id}`,
    );
  } catch (err) {
    console.error("[google callback]", err);
    return NextResponse.redirect(`${origin}/onboarding?step=drive&error=token`);
  }
}
