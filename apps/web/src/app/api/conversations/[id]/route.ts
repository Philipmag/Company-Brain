import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json, errorJson } from "@/lib/api";

/** Get a conversation + its messages (RLS enforces ownership). */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    await requireSession();
    const supabase = createClient();

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, title, created_at, channel")
      .eq("id", params.id)
      .maybeSingle();
    if (!conversation) return errorJson("Conversation not found", 404);

    const { data: messages, error } = await supabase
      .from("messages")
      .select(
        "id, role, content, cited_document_ids, feedback, feedback_comment, created_at",
      )
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    // Resolve cited documents for rendering source pills.
    const docIds = [
      ...new Set((messages ?? []).flatMap((m) => m.cited_document_ids ?? [])),
    ];
    let documents: Array<{
      id: string;
      title: string | null;
      source_type: string;
      source_url: string | null;
    }> = [];
    if (docIds.length > 0) {
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, source_type, source_url")
        .in("id", docIds);
      documents = docs ?? [];
    }

    return json({ conversation, messages: messages ?? [], documents });
  });
}
