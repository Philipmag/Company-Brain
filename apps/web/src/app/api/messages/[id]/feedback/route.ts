import { type NextRequest } from "next/server";
import { writeAudit } from "@company-brain/shared";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json, errorJson } from "@/lib/api";
import { captureEvent } from "@/lib/analytics";

interface Body {
  feedback: "up" | "down";
  comment?: string;
}

/**
 * Submit 👍/👎 feedback on an assistant message (spec §3.3 / Flow B step 5).
 * RLS ensures the user can only update messages in their own conversations.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { user, org } = await requireSession();
    const body = (await request.json()) as Body;
    if (body.feedback !== "up" && body.feedback !== "down") {
      return errorJson("feedback must be 'up' or 'down'", 400);
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .update({
        feedback: body.feedback,
        feedback_comment: body.comment ?? null,
      })
      .eq("id", params.id)
      .select("id, cited_document_ids")
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorJson("Message not found", 404);

    await writeAudit(
      org.id,
      "feedback.given",
      { messageId: params.id, feedback: body.feedback },
      user.id,
    );
    await captureEvent("feedback_given", user.id, {
      orgId: org.id,
      feedback: body.feedback,
    });

    return json({ ok: true });
  });
}
