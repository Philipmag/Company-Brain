import { type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json } from "@/lib/api";

/** List documents, filterable by status / visibility group (spec §5). */
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireRole(["admin", "curator"]);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const group = searchParams.get("group");

    const supabase = createClient();
    let query = supabase
      .from("documents")
      .select(
        "id, title, source_type, source_url, status, visibility_group_ids, last_modified_at, last_verified_at, citation_count_30d, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) query = query.eq("status", status);
    if (group) query = query.contains("visibility_group_ids", [group]);

    const { data, error } = await query;
    if (error) throw error;
    return json({ documents: data ?? [] });
  });
}
