import { type NextRequest } from "next/server";
import { writeAudit } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json, errorJson } from "@/lib/api";

/** Mark a document verified (resets the stale timer) — spec §3.5 / Flow E. */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin", "curator"]);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("documents")
      .update({ last_verified_at: new Date().toISOString() })
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorJson("Document not found", 404);
    await writeAudit(org.id, "document.verified", { documentId: params.id }, user.id);
    return json({ ok: true });
  });
}
