import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant";
import { refreshSignedArtifactUrl } from "@/lib/supabase/storage-urls";

/**
 * One pull request: its latest run, the structured test cases it produced, and
 * the findings recorded against the repository (open and dismissed).
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const { data: pr, error } = await admin
    .from("pull_requests")
    .select("*")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Unknown and unowned both answer 404 so the endpoint never confirms the
  // existence of another tenant's pull request.
  if (!pr || !projectIds.includes(pr.project_id)) {
    return NextResponse.json({ error: "Pull request not found for this account." }, { status: 404 });
  }

  const [runResult, casesResult, findingsResult] = await Promise.all([
    pr.latest_run_id
      ? admin.from("runs").select("id, status, completed_at, created_at, result, video_url, trace_url").eq("id", pr.latest_run_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pr.latest_run_id
      ? admin
          .from("test_cases")
          .select("*")
          .eq("run_id", pr.latest_run_id)
          .order("status", { ascending: true })
      : Promise.resolve({ data: [] }),
    admin
      .from("findings")
      .select("*")
      .eq("repo_full_name", pr.repo_full_name)
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  const cases = (casesResult.data || []).map((row: any) => ({
    id: row.id,
    run_id: row.run_id,
    name: row.name,
    route: row.route,
    status: row.status,
    category: row.category,
    severity: row.severity,
    impact: row.impact,
    failure_reason: row.failure_reason,
    reproduction_steps: row.reproduction_steps || [],
    code_analysis: row.code_analysis || [],
    mock_context: row.mock_context || [],
    evidence: row.evidence || {},
    origin: row.origin,
    verified_this_commit: row.verified_this_commit,
  }));

  const findings = (findingsResult.data || []).map((row: any) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    severity: row.severity,
    category: row.category,
    title: row.title,
    detail: row.detail,
    route: row.route,
    status: row.status,
    occurrences: row.occurrences,
    dismissed_at: row.dismissed_at,
    dismiss_reason: row.dismiss_reason,
    updated_at: row.updated_at,
  }));

  // Supabase Storage signed URLs expire an hour after issue; a PR opened
  // later than that would otherwise hand back a dead video/trace link.
  const [videoUrl, traceUrl] = runResult.data
    ? await Promise.all([
        refreshSignedArtifactUrl(admin, runResult.data.video_url),
        refreshSignedArtifactUrl(admin, runResult.data.trace_url),
      ])
    : [null, null];

  return NextResponse.json({
    pull_request: pr,
    run: runResult.data
      ? {
          id: runResult.data.id,
          status: runResult.data.status,
          result_status: runResult.data.result?.status ?? null,
          severity_summary: runResult.data.result?.severity_summary ?? null,
          change_impact: runResult.data.result?.change_impact ?? null,
          environment_context: runResult.data.result?.environment_context ?? null,
          video_url: videoUrl,
          trace_url: traceUrl,
          completed_at: runResult.data.completed_at,
          created_at: runResult.data.created_at,
        }
      : null,
    test_cases: cases,
    findings,
  });
}
