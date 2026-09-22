import { type NextRequest } from "next/server";
import { WebClient } from "@slack/web-api";
import {
  getAdminClient,
  decryptNullable,
  retrieveContext,
  generateAnswer,
  extractCitedDocumentIds,
  upsertKnowledgeGap,
  fallbackMessage,
  writeAudit,
  type Connection,
  type AppUser,
} from "@company-brain/shared";
import { verifySlackSignature, parseSlackForm } from "@/lib/connectors/slack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Slack /ask slash command (spec §3 Flow C / §7).
 * Responds ephemerally with a cited answer + 👍/👎 + "Share to channel".
 *
 * NOTE: Slack expects an ack within 3s. For the MVP we answer inline; for
 * production the answer should be posted to response_url from a background job.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const valid = verifySlackSignature(
    rawBody,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!valid) {
    return new Response("invalid signature", { status: 401 });
  }

  const form = parseSlackForm(rawBody);
  const teamId = form.team_id;
  const slackUserId = form.user_id;
  const question = (form.text ?? "").trim();

  if (!question) {
    return ephemeral("Please include a question, e.g. `/ask What is our PTO policy?`");
  }

  const admin = getAdminClient();
  const { data: connection } = await admin
    .from("connections")
    .select("*")
    .eq("provider", "slack")
    .eq("status", "active")
    .filter("scope_config->>team_id", "eq", teamId)
    .maybeSingle<Connection>();
  if (!connection) {
    return ephemeral("This Slack workspace isn't connected to Company Brain.");
  }

  const botToken = decryptNullable(connection.oauth_access_token);
  if (!botToken) return ephemeral("Slack connection is misconfigured (no token).");

  // Map the Slack user to a Company Brain user by email.
  const slack = new WebClient(botToken);
  let email: string | undefined;
  try {
    const info = await slack.users.info({ user: slackUserId });
    email = info.user?.profile?.email ?? undefined;
  } catch {
    /* fall through */
  }
  if (!email) {
    return ephemeral(
      "I couldn't read your email from Slack. Ask your admin to invite you to Company Brain first.",
    );
  }

  const { data: appUser } = await admin
    .from("users")
    .select("*")
    .eq("org_id", connection.org_id)
    .eq("email", email.toLowerCase())
    .maybeSingle<AppUser>();
  if (!appUser) {
    return ephemeral(
      "You're not a member of this Company Brain organization yet. Ask your admin to invite you.",
    );
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", connection.org_id)
    .single<{ id: string; name: string }>();
  const orgName = org?.name ?? "your organization";

  // Run retrieval + generation (same pipeline as web chat).
  const retrieval = await retrieveContext({
    orgId: appUser.org_id,
    visibilityGroupIds: appUser.visibility_group_ids,
    query: question,
  });

  // Record a slack conversation + user message.
  const { data: convo } = await admin
    .from("conversations")
    .insert({
      org_id: appUser.org_id,
      user_id: appUser.id,
      channel: "slack",
      title: question.slice(0, 80),
    })
    .select("id")
    .single<{ id: string }>();
  await admin.from("messages").insert({
    conversation_id: convo?.id,
    org_id: appUser.org_id,
    role: "user",
    content: question,
  });

  if (retrieval.belowThreshold || retrieval.contexts.length === 0) {
    const fallback = fallbackMessage(orgName);
    await admin.from("messages").insert({
      conversation_id: convo?.id,
      org_id: appUser.org_id,
      role: "assistant",
      content: fallback,
      cited_document_ids: [],
      retrieval_top_score: retrieval.topScore,
    });
    await upsertKnowledgeGap(appUser.org_id, question);
    return ephemeral(fallback);
  }

  const { text: answer, usage } = await generateAnswer({
    orgName,
    contexts: retrieval.contexts,
    history: [],
    question,
  });
  const citedDocumentIds = extractCitedDocumentIds(answer, retrieval.contexts);

  const { data: assistantMsg } = await admin
    .from("messages")
    .insert({
      conversation_id: convo?.id,
      org_id: appUser.org_id,
      role: "assistant",
      content: answer,
      cited_document_ids: citedDocumentIds,
      retrieval_top_score: retrieval.topScore,
    })
    .select("id")
    .single<{ id: string }>();

  await writeAudit(appUser.org_id, "chat.answered", { channel: "slack", usage }, appUser.id);

  return blockKitAnswer(answer, retrieval.contexts, assistantMsg?.id ?? "");
}

function ephemeral(text: string): Response {
  return Response.json({ response_type: "ephemeral", text });
}

function blockKitAnswer(
  answer: string,
  contexts: { documentTitle: string; sourceUrl: string | null }[],
  messageId: string,
): Response {
  const sourceLines = contexts
    .map((c, i) =>
      c.sourceUrl
        ? `[${i + 1}] <${c.sourceUrl}|${c.documentTitle}>`
        : `[${i + 1}] ${c.documentTitle}`,
    )
    .join("\n");

  return Response.json({
    response_type: "ephemeral",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: answer } },
      ...(sourceLines
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: `*Sources*\n${sourceLines}` }] }]
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "👍" },
            action_id: "feedback_up",
            value: messageId,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "👎" },
            action_id: "feedback_down",
            value: messageId,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Share to channel" },
            action_id: "share_to_channel",
            value: messageId,
          },
        ],
      },
    ],
  });
}
