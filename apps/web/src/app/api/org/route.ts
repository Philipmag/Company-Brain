import { type NextRequest } from "next/server";
import { getAdminClient } from "@company-brain/shared";
import { getAuthUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json, errorJson } from "@/lib/api";
import { captureEvent } from "@/lib/analytics";

/**
 * Create an organization for the current auth user and make them its first admin
 * (spec §3.1). The default visibility groups are seeded by a DB trigger; the new
 * admin is added to both.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const authUserId = await getAuthUserId();
    if (!authUserId) return errorJson("Not authenticated", 401);

    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) return errorJson("Organization name is required", 400);

    // Use the service role to create cross-table rows atomically-ish.
    const admin = getAdminClient();

    // Guard: a user can only belong to one org in the MVP.
    const { data: existing } = await admin
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    if (existing) return errorJson("User already belongs to an organization", 409);

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name })
      .select("*")
      .single();
    if (orgErr || !org) throw orgErr ?? new Error("Failed to create org");

    // The trigger seeded all_staff + leadership; fetch them.
    const { data: groups } = await admin
      .from("visibility_groups")
      .select("id")
      .eq("org_id", org.id);
    const groupIds = (groups ?? []).map((g) => g.id);

    // Read the auth user's email.
    const supabase = createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    const { error: userErr } = await admin.from("users").insert({
      id: authUserId,
      org_id: org.id,
      email: authUser?.email ?? "",
      role: "admin",
      visibility_group_ids: groupIds,
    });
    if (userErr) throw userErr;

    await captureEvent("onboarding_started", authUserId, { orgId: org.id });

    return json({ org });
  });
}
