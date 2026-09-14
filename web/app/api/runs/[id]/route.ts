import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canAccessRepo, resolveTenantScope } from "@/lib/tenant";

/**
 * One test run: the run record itself plus the structured test cases it
 * produced, and (when the run came from a GitHub pull request) the pull request
 * metadata needed to label the page.
 *
 * The engine is the source of truth while it is reachable; Supabase is the
 * durable fallback. Either way the caller's tenant scope is enforced before a
 * byte of the payload is returned, and an inaccessible run is answered with a
 * 404 so the endpoint never confirms that someone else's run exists.
 */

export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.PLATFORM_URL || process.env.AGENT_URL || "http://127.0.0.1:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

async function fetchEngineRun(id: string): Promise<Record<string, any> | null> {
  if (!ENGINE_API_KEY) return null;
  try {
    const res = await fetch(`${ENGINE_URL}/runs/${encodeURIComponent(id)}`, {
      headers: engineHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    // Engine offline or slow — the Supabase row below is the fallback.
    return null;
  }
}

function mapTestCase(row: any) {
  return {
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
  };
}

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
  let scope: Awaited<ReturnType<typeof resolveTenantScope>>;
  try {
    admin = createAdminClient();
    scope = await resolveTenantScope(admin, user.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Cannot resolve access: ${message}` }, { status: 503 });
  }

  const [engineRun, dbRunResult] = await Promise.all([
    fetchEngineRun(id),
    admin.from("runs").select("*").eq("id", id).maybeSingle(),
  ]);

  const dbRun = dbRunResult.data;

  // A run the database knows about is authorised by its project; an unowned row
  // (project_id null) is only visible when the deployment opted into that.
  if (dbRun && !scope.includeUnowned && !scope.projectIds.includes(dbRun.project_id)) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  const record: Record<string, any> | null = engineRun || dbRun || null;
  if (!record) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  // The run exists only in the engine (no database row), so the repository it
  // names is the only thing left to check it against.
  let repo: string | null = record.repo || record.repo_full_name || null;
  if (!dbRun && !scope.includeUnowned) {
    if (!canAccessRepo(scope, repo)) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
  }

  // Runs only store `project_id`; resolve it to the repository name the UI
  // labels the page with.
  if (!repo && dbRun?.project_id) {
    const { data: project } = await admin
      .from("projects")
      .select("repo_full_name")
      .eq("id", dbRun.project_id)
      .maybeSingle();
    repo = project?.repo_full_name ?? null;
  }

  const result = (record.result || {}) as Record<string, any>;
  const prNumber = record.pr_number ?? record.github_pr_number ?? null;

  const [casesResult, prResult] = await Promise.all([
    admin
      .from("test_cases")
      .select("*")
      .eq("run_id", id)
      // failed → passed → skipped: the cases that need attention sort first.
      .order("status", { ascending: true })
      .order("created_at", { ascending: true }),
    repo && prNumber
      ? admin
          .from("pull_requests")
          .select("title, author_login, html_url, state, is_draft, head_branch, base_branch, head_sha, opened_at")
          .eq("repo_full_name", repo)
          .eq("pr_number", prNumber)
          .maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  const pr = prResult?.data || null;

  // The PR-centric projection that writes `test_cases` is best-effort, so a run
  // can carry its cases in `result.test_cases` without rows ever landing in the
  // table. Fall back to those rather than showing an empty list.
  const dbCases = casesResult.data || [];
  const testCases =
    dbCases.length > 0
      ? dbCases.map(mapTestCase)
      : Array.isArray(result.test_cases)
      ? result.test_cases.map((c: any, index: number) => ({
          ...c,
          id: c.id ?? `${id}-case-${index}`,
          run_id: id,
          reproduction_steps: c.reproduction_steps || [],
          code_analysis: c.code_analysis || [],
          mock_context: c.mock_context || [],
          evidence: c.evidence || {},
        }))
      : [];

  return NextResponse.json({
    run: {
      id: record.id || id,
      repo,
      branch: record.branch || null,
      sha: record.sha || null,
      scope: record.scope || "changed",
      test_type: record.test_type || "functional",
      status: record.status || "queued",
      created_at: record.created_at || null,
      completed_at: record.completed_at || null,
      result_status: result.status ?? null,
      error: result.error ?? record.error ?? null,
      failure_kind: result.failure_kind ?? null,
      // Full redacted build/boot output (bounded by the engine), or the
      // failure message for non-build failures. Surfaced so a failed build is
      // debuggable in the dashboard instead of only on GitHub.
      build_log: result.build_log ?? null,
      summary: result.summary ?? null,
      duration_s: result.duration_s ?? result.timing?.total_duration_s ?? null,
      timing: result.timing ?? null,
      severity_summary: result.severity_summary ?? null,
      change_impact: result.change_impact ?? null,
      environment_context: result.environment_context ?? null,
      video_url: record.video_url || result.video_url || null,
      trace_url: record.trace_url || result.trace_url || null,
      screenshot_url: result.screenshot_url || null,
      console_errors: result.console_errors || [],
      journey_artifacts: result.journey_artifacts || [],
      agentic_session: result.agentic_session || null,
      fix_proposals: result.fix_proposals || [],
      remediation_prompt: result.remediation_prompt || null,
      pr_number: prNumber,
      pr_title: pr?.title ?? null,
      pr_author: pr?.author_login ?? record.triggering_user ?? result.triggering_user ?? null,
      pr_url: pr?.html_url ?? (repo && prNumber ? `https://github.com/${repo}/pull/${prNumber}` : null),
      pr_state: pr?.state ?? null,
      pr_head_branch: pr?.head_branch ?? record.branch ?? null,
      pr_base_branch: pr?.base_branch ?? null,
      pr_opened_at: pr?.opened_at ?? null,
    },
    test_cases: testCases,
  });
}
