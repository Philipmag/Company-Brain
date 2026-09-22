import { type NextRequest } from "next/server";
import {
  getAdminClient,
  retrieveContext,
  rewriteQuery,
  streamAnswer,
  embedText,
  extractCitedDocumentIds,
  upsertKnowledgeGap,
  writeAudit,
  fallbackMessage,
  type ConversationTurn,
  type Message,
} from "@company-brain/shared";
import { requireSession } from "@/lib/auth";
import { errorJson } from "@/lib/api";
import { checkChatRateLimit } from "@/lib/rateLimit";
import { captureEvent } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  conversationId?: string;
  message: string;
}

/**
 * Chat endpoint (spec §6.3). Streams the answer via Server-Sent Events.
 * Events: {type:"meta"|"delta"|"done"|"error", ...}.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return errorJson("Not authenticated", 401);
  }
  const { user, org } = session;

  // Rate limit (spec §8).
  const rl = await checkChatRateLimit(org.id, org.plan_tier);
  if (!rl.allowed) {
    return errorJson(
      "You've hit your plan's question limit for this hour. Please try again later.",
      429,
    );
  }

  const body = (await request.json()) as Body;
  const question = body.message?.trim();
  if (!question) return errorJson("Message is required", 400);

  const admin = getAdminClient();

  // Resolve or create the conversation.
  let conversationId = body.conversationId ?? null;
  let isFirstMessage = false;
  if (!conversationId) {
    const { data: convo, error } = await admin
      .from("conversations")
      .insert({
        org_id: org.id,
        user_id: user.id,
        channel: "web",
        title: question.slice(0, 80),
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !convo) return errorJson("Failed to create conversation", 500);
    conversationId = convo.id;
    isFirstMessage = true;
  } else {
    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    isFirstMessage = (count ?? 0) === 0;
  }

  // Persist the user message.
  await admin.from("messages").insert({
    conversation_id: conversationId,
    org_id: org.id,
    role: "user",
    content: question,
  });

  // Load recent history (last 6 messages = ~3 turns).
  const { data: historyRows } = await admin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(7);
  const history: ConversationTurn[] = (historyRows ?? [])
    .reverse()
    .slice(0, -1) // drop the just-inserted user message
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (isFirstMessage) {
    await captureEvent("first_question_asked", user.id, { orgId: org.id });
  }

  const encoder = new TextEncoder();
  const cid = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        send({ type: "meta", conversationId: cid });

        // 1. Query rewrite (skip on first message).
        const searchQuery = isFirstMessage
          ? question
          : await rewriteQuery(history, question);

        // 2. Embed + 3-6. hybrid retrieval, curated override, threshold.
        const embedding = await embedText(searchQuery);
        const retrieval = await retrieveContext({
          orgId: org.id,
          visibilityGroupIds: user.visibility_group_ids,
          query: searchQuery,
          queryEmbedding: embedding,
        });

        if (retrieval.belowThreshold || retrieval.contexts.length === 0) {
          const fallback = fallbackMessage(org.name);
          send({ type: "delta", text: fallback });
          await admin.from("messages").insert({
            conversation_id: cid,
            org_id: org.id,
            role: "assistant",
            content: fallback,
            cited_document_ids: [],
            retrieval_top_score: retrieval.topScore,
          });
          await upsertKnowledgeGap(org.id, question);
          await captureEvent("knowledge_gap_created", user.id, { orgId: org.id });
          send({ type: "done", citedDocumentIds: [] });
          controller.close();
          return;
        }

        // Send the sources up-front so the UI can render citation pills.
        send({
          type: "sources",
          sources: retrieval.contexts.map((c, i) => ({
            index: i + 1,
            documentId: c.documentId,
            title: c.documentTitle,
            sourceType: c.sourceType,
            sourceUrl: c.sourceUrl,
            isCurated: c.isCurated,
          })),
        });

        // 7-8. Build prompt + stream Claude Sonnet.
        let answer = "";
        let usage = { inputTokens: 0, outputTokens: 0 };
        for await (const delta of streamAnswer(
          {
            orgName: org.name,
            contexts: retrieval.contexts,
            history,
            question,
          },
          (u) => (usage = u),
        )) {
          answer += delta;
          send({ type: "delta", text: delta });
        }

        // 9. Parse citations + persist.
        const citedDocumentIds = extractCitedDocumentIds(answer, retrieval.contexts);
        const { data: assistantMsg } = await admin
          .from("messages")
          .insert({
            conversation_id: cid,
            org_id: org.id,
            role: "assistant",
            content: answer,
            cited_document_ids: citedDocumentIds,
            retrieval_top_score: retrieval.topScore,
          })
          .select("id")
          .single<Pick<Message, "id">>();

        await writeAudit(
          org.id,
          "chat.answered",
          {
            tokens: usage,
            topScore: retrieval.topScore,
            cited: citedDocumentIds.length,
          },
          user.id,
        );

        send({
          type: "done",
          messageId: assistantMsg?.id,
          citedDocumentIds,
        });
        controller.close();
      } catch (err) {
        console.error("[chat] generation error:", err);
        // LLM failures are not logged as knowledge gaps (spec §8).
        send({
          type: "error",
          message:
            "Something went wrong generating a response — please try again.",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
