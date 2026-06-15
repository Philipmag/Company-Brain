import { type NextRequest } from "next/server";
import { getAdminClient, writeAudit } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handle, json, errorJson } from "@/lib/api";

/** List visibility groups (spec §3.4 Settings). */
export async function GET() {
  return handle(async () => {
    await requireRole(["admin", "curator"]);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("visibility_groups")
      .select("id, name, slug, is_default, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return json({ groups: data ?? [] });
  });
}

interface Body {
  name: string;
}

/** Create a visibility group (admin only). */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin"]);
    const body = (await request.json()) as Body;
    const name = body.name?.trim();
    if (!name) return errorJson("Name is required", 400);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("visibility_groups")
      .insert({ org_id: org.id, name, slug, is_default: false })
      .select("id, name, slug, is_default")
      .single();
    if (error) return errorJson(error.message, 400);
    await writeAudit(org.id, "visibility_group.created", { slug }, user.id);
    return json({ group: data });
  });
}
