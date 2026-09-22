import { type NextRequest } from "next/server";
import {
  getAdminClient,
  embedText,
  toPgVector,
  countTokens,
  writeAudit,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

interface Body {
  question: string;
  answer: string;
  visibility_group_ids?: string[];
  documentId?: string; // when editing an existing curated answer
  gapId?: string; // when answering a knowledge gap
}

/**
 * Create or update a curated answer (spec §3.5 / §6.5). Stored as a documents
 * row with source_type='curated' plus a single embedded chunk so it can be
 * matched and injected as context item [1].
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin", "curator"]);
    const body = (await request.json()) as Body;
    const question = body.question?.trim();
    const answer = body.answer?.trim();
    if (!question || !answer) return errorJson("Question and answer are required", 400);

    const admin = getAdminClient();

    // Default to org default groups if unspecified.
    let groups = body.visibility_group_ids ?? [];
    if (groups.length === 0) {
      const { data } = await admin
        .from("visibility_groups")
        .select("id")
        .eq("org_id", org.id)
        .eq("is_default", true);
      groups = (data ?? []).map((g) => g.id);
    }

    const chunkContent = `Q: ${question}\nA: ${answer}`;
    const embedding = await embedText(chunkContent);

    let documentId = body.documentId ?? null;
    if (documentId) {
      await admin
        .from("documents")
        .update({
          title: question,
          visibility_group_ids: groups,
          last_modified_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString(),
          status: "indexed",
        })
        .eq("id", documentId)
        .eq("org_id", org.id);
      await admin.from("chunks").delete().eq("document_id", documentId);
    } else {
      const { data: doc, error } = await admin
        .from("documents")
        .insert({
          org_id: org.id,
          connection_id: null,
          source_type: "curated",
          title: question,
          source_url: null,
          visibility_group_ids: groups,
          last_modified_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString(),
          status: "indexed",
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !doc) throw error ?? new Error("Failed to create curated answer");
      documentId = doc.id;
    }

    await admin.from("chunks").insert({
      org_id: org.id,
      document_id: documentId,
      content: chunkContent,
      embedding: toPgVector(embedding),
      token_count: countTokens(chunkContent),
      chunk_index: 0,
      metadata: { curated: true },
      visibility_group_ids: groups,
    });

    if (body.gapId) {
      await admin
        .from("knowledge_gaps")
        .update({ status: "answered" })
        .eq("id", body.gapId)
        .eq("org_id", org.id);
    }

    await writeAudit(org.id, "curated_answer.saved", { documentId }, user.id);
    return json({ documentId });
  });
}
