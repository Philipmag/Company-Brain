import { type NextRequest } from "next/server";
import {
  getAdminClient,
  writeAudit,
  type VisibilityGroup,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

interface Body {
  name?: string;
}

/** Rename a visibility group (admin only). Default groups can be renamed. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org } = await requireRole(["admin"]);
    const body = (await request.json()) as Body;
    const name = body.name?.trim();
    if (!name) return errorJson("Name is required", 400);

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("visibility_groups")
      .update({ name })
      .eq("id", params.id)
      .eq("org_id", org.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorJson("Group not found", 404);
    return json({ ok: true });
  });
}

/** Delete a visibility group (admin only). Default groups cannot be deleted. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin"]);
    const admin = getAdminClient();
    const { data: group } = await admin
      .from("visibility_groups")
      .select("*")
      .eq("id", params.id)
      .eq("org_id", org.id)
      .single<VisibilityGroup>();
    if (!group) return errorJson("Group not found", 404);
    if (group.is_default) {
      return errorJson("Default groups cannot be deleted", 400);
    }
    await admin.from("visibility_groups").delete().eq("id", params.id);
    await writeAudit(org.id, "visibility_group.deleted", { slug: group.slug }, user.id);
    return json({ ok: true });
  });
}
