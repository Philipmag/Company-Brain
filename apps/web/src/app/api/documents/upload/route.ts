import { type NextRequest } from "next/server";
import {
  getAdminClient,
  enqueueProcessDocument,
  writeAudit,
} from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const UPLOAD_BUCKET = "uploads";

/**
 * Direct file upload (spec §5 / Phase 4). Stores the file in Supabase Storage,
 * creates a documents row (source_type='upload'), and feeds it into the same
 * process-document -> chunk -> embed pipeline.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const { org, user } = await requireRole(["admin", "curator"]);
    const form = await request.formData();
    const file = form.get("file");
    const visibilityGroupIds = form
      .getAll("visibility_group_ids")
      .map((v) => String(v))
      .filter(Boolean);

    if (!(file instanceof File)) return errorJson("No file provided", 400);

    const admin = getAdminClient();

    // Default to org default groups if none specified.
    let groups = visibilityGroupIds;
    if (groups.length === 0) {
      const { data } = await admin
        .from("visibility_groups")
        .select("id")
        .eq("org_id", org.id)
        .eq("is_default", true);
      groups = (data ?? []).map((g) => g.id);
    }

    const path = `${org.id}/${crypto.randomUUID()}-${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await admin.storage
      .from(UPLOAD_BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadErr) throw uploadErr;

    const { data: doc, error: docErr } = await admin
      .from("documents")
      .insert({
        org_id: org.id,
        connection_id: null,
        source_type: "upload",
        source_id: path,
        title: file.name,
        source_url: null,
        visibility_group_ids: groups,
        last_modified_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single<{ id: string }>();
    if (docErr || !doc) throw docErr ?? new Error("Failed to create document");

    await enqueueProcessDocument({
      orgId: org.id,
      connectionId: null,
      sourceRef: path,
      sourceType: "upload",
      documentId: doc.id,
    });
    await writeAudit(org.id, "document.uploaded", { documentId: doc.id }, user.id);

    return json({ documentId: doc.id });
  });
}
