import { getAdminClient, STALE_AFTER_DAYS } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/api";

/**
 * Content Health tab (spec §3.4 / Flow E): documents never verified or stale
 * (>6 months), ordered by 30-day citation count (highest-impact first).
 */
export async function GET() {
  return handle(async () => {
    const { org } = await requireRole(["admin", "curator"]);
    const admin = getAdminClient();
    const staleCutoff = new Date(
      Date.now() - STALE_AFTER_DAYS * 86_400_000,
    ).toISOString();

    const { data, error } = await admin
      .from("documents")
      .select(
        "id, title, source_type, source_url, visibility_group_ids, last_verified_at, last_modified_at, citation_count_30d",
      )
      .eq("org_id", org.id)
      .eq("status", "indexed")
      .neq("source_type", "curated")
      .or(`last_verified_at.is.null,last_verified_at.lt.${staleCutoff}`)
      .order("citation_count_30d", { ascending: false })
      .limit(200);
    if (error) throw error;
    return json({ documents: data ?? [] });
  });
}
