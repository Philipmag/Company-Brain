import { type NextRequest } from "next/server";
import { getAdminClient, writeAudit, type UserRole } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

interface Body {
  role?: UserRole;
  visibility_group_ids?: string[];
}

/** Update a member's role / visibility groups (admin only) — spec §3.4. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin"]);
    const body = (await request.json()) as Body;

    const update: Record<string, unknown> = {};
    if (body.role) {
      if (!["admin", "curator", "member"].includes(body.role)) {
        return errorJson("Invalid role", 400);
      }
      update.role = body.role;
    }
    if (body.visibility_group_ids) update.visibility_group_ids = body.visibility_group_ids;
    if (Object.keys(update).length === 0) return errorJson("Nothing to update", 400);

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("users")
      .update(update)
      .eq("id", params.id)
      .eq("org_id", org.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorJson("User not found", 404);

    await writeAudit(org.id, "user.updated", { userId: params.id, ...update }, user.id);
    return json({ ok: true });
  });
}
