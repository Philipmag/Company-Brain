import { type NextRequest } from "next/server";
import { getAdminClient, writeAudit, type UserRole } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

interface Body {
  email: string;
  role?: UserRole;
  visibility_group_ids?: string[];
}

/**
 * Invite a teammate via Supabase magic-link invite (spec §3.4 / §5). Creates the
 * auth user and a corresponding users row scoped to this org.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin"]);
    const body = (await request.json()) as Body;
    const email = body.email?.trim().toLowerCase();
    if (!email) return errorJson("Email is required", 400);
    const role: UserRole = body.role ?? "member";

    const admin = getAdminClient();

    // Default to org default groups.
    let groups = body.visibility_group_ids ?? [];
    if (groups.length === 0) {
      const { data } = await admin
        .from("visibility_groups")
        .select("id")
        .eq("org_id", org.id)
        .eq("is_default", true);
      groups = (data ?? []).map((g) => g.id);
    }

    const redirectTo = `${process.env.APP_URL ?? "http://localhost:3000"}/auth/callback`;
    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteErr || !invited?.user) {
      return errorJson(inviteErr?.message ?? "Invite failed", 400);
    }

    const { error: userErr } = await admin.from("users").upsert(
      {
        id: invited.user.id,
        org_id: org.id,
        email,
        role,
        visibility_group_ids: groups,
      },
      { onConflict: "id" },
    );
    if (userErr) throw userErr;

    await writeAudit(org.id, "user.invited", { email, role }, user.id);
    return json({ ok: true, userId: invited.user.id });
  });
}
