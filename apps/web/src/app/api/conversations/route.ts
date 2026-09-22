import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json } from "@/lib/api";

/** List the current user's conversations (RLS scopes to the owner). */
export async function GET() {
  return handle(async () => {
    await requireSession();
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, channel")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return json({ conversations: data ?? [] });
  });
}
