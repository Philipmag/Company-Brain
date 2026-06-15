import { getAdminClient } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/api";

/** Overview dashboard stats (spec §3.4 Overview / acceptance criterion 9). */
export async function GET() {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const admin = getAdminClient();

    const { data: stats } = await admin
      .rpc("org_overview_stats", { p_org_id: org.id })
      .single<{ documents_indexed: number; total_chunks: number; questions_7d: number }>();

    const { data: connections } = await admin
      .from("connections")
      .select("id, provider, status, last_synced_at, display_name")
      .eq("org_id", org.id);

    return json({
      documentsIndexed: Number(stats?.documents_indexed ?? 0),
      totalChunks: Number(stats?.total_chunks ?? 0),
      questions7d: Number(stats?.questions_7d ?? 0),
      connectors: connections ?? [],
    });
  });
}
