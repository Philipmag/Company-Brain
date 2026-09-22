import { type NextRequest } from "next/server";
import {
  getAdminClient,
  enqueueSync,
  writeAudit,
  type Connection,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

/** Manually trigger a sync (spec §5 — "Sync now"). */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const admin = getAdminClient();
    const { data: connection } = await admin
      .from("connections")
      .select("id, org_id")
      .eq("id", params.id)
      .eq("org_id", org.id)
      .single<Pick<Connection, "id" | "org_id">>();
    if (!connection) return errorJson("Connection not found", 404);

    await enqueueSync({ connectionId: params.id, orgId: org.id });
    await writeAudit(org.id, "connector.sync_triggered", { connectionId: params.id });
    return json({ ok: true });
  });
}
