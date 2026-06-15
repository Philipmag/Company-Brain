import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json } from "@/lib/api";

/** List org members (spec §3.4 Team tab). */
export async function GET() {
  return handle(async () => {
    await requireRole(["admin"]);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("users")
      .select("id, email, display_name, role, visibility_group_ids, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return json({ users: data ?? [] });
  });
}
