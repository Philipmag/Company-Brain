import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/api";
import { requireEnv, optionalEnv } from "@company-brain/shared";

const SCOPES = ["commands", "chat:write", "users:read", "users:read.email", "channels:read"];

/** Begin Slack OAuth (spec §7). Returns the install URL. */
export async function POST() {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const clientId = requireEnv("SLACK_CLIENT_ID");
    const redirectUri = optionalEnv(
      "SLACK_REDIRECT_URI",
      "http://localhost:3000/api/connections/slack/callback",
    );
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", org.id);
    return json({ url: url.toString() });
  });
}
