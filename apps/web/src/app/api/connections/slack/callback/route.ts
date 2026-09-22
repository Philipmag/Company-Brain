import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminClient,
  encryptNullable,
  writeAudit,
  requireEnv,
  optionalEnv,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { captureEvent } from "@/lib/analytics";

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string; // bot token (xoxb-...)
  team?: { id: string; name: string };
  bot_user_id?: string;
}

/** Slack OAuth callback (spec §7). Stores the encrypted bot token. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/onboarding?step=slack&error=oauth`);

  let session;
  try {
    session = await requireRole(["admin"]);
  } catch {
    return NextResponse.redirect(`${origin}/login`);
  }

  try {
    const body = new URLSearchParams({
      code,
      client_id: requireEnv("SLACK_CLIENT_ID"),
      client_secret: requireEnv("SLACK_CLIENT_SECRET"),
      redirect_uri: optionalEnv(
        "SLACK_REDIRECT_URI",
        "http://localhost:3000/api/connections/slack/callback",
      ),
    });
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as SlackOAuthResponse;
    if (!data.ok || !data.access_token) {
      throw new Error(data.error ?? "Slack OAuth failed");
    }

    const admin = getAdminClient();
    const { data: connection, error } = await admin
      .from("connections")
      .insert({
        org_id: session.org.id,
        provider: "slack",
        display_name: data.team?.name ?? "Slack",
        oauth_access_token: encryptNullable(data.access_token),
        scope_config: {
          team_id: data.team?.id,
          team_name: data.team?.name,
          bot_user_id: data.bot_user_id,
        },
        status: "active",
        created_by: session.user.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !connection) throw error ?? new Error("insert failed");

    await writeAudit(session.org.id, "connector.connected", {
      provider: "slack",
      connectionId: connection.id,
    });
    await captureEvent("connector_connected", session.user.id, { provider: "slack" });

    return NextResponse.redirect(`${origin}/onboarding?step=slack&connected=1`);
  } catch (err) {
    console.error("[slack callback]", err);
    return NextResponse.redirect(`${origin}/onboarding?step=slack&error=token`);
  }
}
