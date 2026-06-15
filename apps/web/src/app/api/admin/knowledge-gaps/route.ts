import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json } from "@/lib/api";

/** List knowledge gaps, sorted by frequency desc (spec §3.4). */
export async function GET() {
  return handle(async () => {
    await requireRole(["admin", "curator"]);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("knowledge_gaps")
      .select("id, question, frequency, status, last_asked_at, created_at")
      .order("frequency", { ascending: false })
      .order("last_asked_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return json({ gaps: data ?? [] });
  });
}
