import { type NextRequest } from "next/server";
import { WebClient } from "@slack/web-api";
import {
  getAdminClient,
  decryptNullable,
  type Connection,
} from "@company-brain/shared";
import { verifySlackSignature, parseSlackForm } from "@/lib/connectors/slack";

export const dynamic = "force-dynamic";

/**
 * Slack interactivity endpoint — handles 👍/👎 feedback and "Share to channel"
 * button clicks (spec §7).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
    )
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  const form = parseSlackForm(rawBody);
  const payload = JSON.parse(form.payload ?? "{}") as {
    actions?: Array<{ action_id: string; value: string }>;
    team?: { id: string };
    channel?: { id: string };
    user?: { id: string };
    message?: { blocks?: unknown[] };
  };
  const action = payload.actions?.[0];
  if (!action) return new Response("ok");

  const admin = getAdminClient();

  if (action.action_id === "feedback_up" || action.action_id === "feedback_down") {
    const feedback = action.action_id === "feedback_up" ? "up" : "down";
    await admin.from("messages").update({ feedback }).eq("id", action.value);
    return Response.json({ text: `Thanks for the feedback! (${feedback === "up" ? "👍" : "👎"})` });
  }

  if (action.action_id === "share_to_channel") {
    const { data: msg } = await admin
      .from("messages")
      .select("content, cited_document_ids")
      .eq("id", action.value)
      .maybeSingle<{ content: string; cited_document_ids: string[] | null }>();
    const teamId = payload.team?.id;
    const channelId = payload.channel?.id;
    if (msg && teamId && channelId) {
      const { data: connection } = await admin
        .from("connections")
        .select("oauth_access_token")
        .eq("provider", "slack")
        .filter("scope_config->>team_id", "eq", teamId)
        .maybeSingle<Pick<Connection, "oauth_access_token">>();
      const token = decryptNullable(connection?.oauth_access_token ?? null);
      if (token) {
        const slack = new WebClient(token);
        await slack.chat.postMessage({
          channel: channelId,
          text: msg.content,
        });
      }
    }
    return Response.json({ text: "Shared to the channel." });
  }

  return new Response("ok");
}
