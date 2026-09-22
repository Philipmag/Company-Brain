import { type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json, errorJson } from "@/lib/api";
import type { KnowledgeGapStatus } from "@company-brain/shared";

interface Body {
  status: KnowledgeGapStatus;
}

/** Update a knowledge gap's status (open/answered/dismissed) — spec §3.4. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    await requireRole(["admin", "curator"]);
    const body = (await request.json()) as Body;
    if (!["open", "answered", "dismissed"].includes(body.status)) {
      return errorJson("Invalid status", 400);
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("knowledge_gaps")
      .update({ status: body.status })
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorJson("Knowledge gap not found", 404);
    return json({ ok: true });
  });
}
