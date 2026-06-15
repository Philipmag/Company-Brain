import { type NextRequest } from "next/server";
import {
  getAdminClient,
  enqueueSync,
  writeAudit,
  type Connection,
  type ScopeConfig,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

interface PatchBody {
  scope_config?: ScopeConfig;
  disconnect?: boolean;
}

/**
 * Update a connection's scope_config (included/excluded folders/channels) or
 * disconnect it (spec §5). Saving a new scope kicks off a sync.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const admin = getAdminClient();

    const { data: connection } = await admin
      .from("connections")
      .select("*")
      .eq("id", params.id)
      .eq("org_id", org.id)
      .single<Connection>();
    if (!connection) return errorJson("Connection not found", 404);

    const body = (await request.json()) as PatchBody;

    if (body.disconnect) {
      await admin
        .from("connections")
        .update({ status: "disconnected" })
        .eq("id", params.id);
      await writeAudit(org.id, "connector.disconnected", { connectionId: params.id });
      return json({ ok: true, status: "disconnected" });
    }

    if (body.scope_config) {
      await admin
        .from("connections")
        .update({ scope_config: body.scope_config, status: "pending" })
        .eq("id", params.id);
      await enqueueSync({ connectionId: params.id, orgId: org.id });
      await writeAudit(org.id, "connector.scope_updated", { connectionId: params.id });
      return json({ ok: true, status: "syncing" });
    }

    return errorJson("Nothing to update", 400);
  });
}
