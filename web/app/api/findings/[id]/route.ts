import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant";

/**
 * Dismiss, reopen, or resolve a finding.
 *
 * Dismissal is what makes the signal trustworthy over time: once a human has
 * judged an issue, the engine must stop reporting it on every later run. The
 * engine preserves `status` when it re-observes a finding, so this endpoint is
 * the only thing that changes it.
 */

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["open", "dismissed", "resolved"]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { status?: string; reason?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const status = (body.status || "").trim();
  if (!ALLOWED.has(status)) {
    return NextResponse.json(
      { error: "status must be one of: open, dismissed, resolved." },
      { status: 400 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  let projectIds: string[];
  try {
    admin = createAdminClient();
    const scope = await resolveTenantScope(admin, user.id);
    projectIds = scope.projectIds;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Cannot resolve access: ${message}` }, { status: 503 });
  }

  const { data: finding } = await admin
    .from("findings")
    .select("id, project_id")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (!finding || !projectIds.includes(finding.project_id)) {
    return NextResponse.json({ error: "Finding not found for this account." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = { status, updated_at: nowIso };
  if (status === "dismissed") {
    update.dismissed_at = nowIso;
    update.dismissed_by = user.id;
    update.dismiss_reason = (body.reason || "").trim() || null;
  } else {
    update.dismissed_at = null;
    update.dismissed_by = null;
    update.dismiss_reason = null;
  }

  const { data, error } = await admin.from("findings").update(update).eq("id", id).select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status, finding: (data || [])[0] ?? null });
}
