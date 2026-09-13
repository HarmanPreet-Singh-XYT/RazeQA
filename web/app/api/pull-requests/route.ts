import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant";

/**
 * Pull-request list for the signed-in tenant.
 *
 * The dashboard used to be run-centric: you could see that a run happened, but
 * not which pull request it belonged to or whether that PR is currently at
 * risk. This returns one row per PR with the latest run's severity rollup, so
 * the primary screen answers "what needs attention before merge".
 *
 * The PR-centric tables arrive with a migration. Until it is applied this
 * answers with an empty list and a `migration_required` flag rather than a 500,
 * so the page can explain the state instead of looking broken.
 */

export const dynamic = "force-dynamic";

const SEVERITY_LEVELS = ["critical", "high", "medium", "low"] as const;

function emptyCounts(): Record<string, number> {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized: sign in to list pull requests." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const repoFilter = searchParams.get("repo");
  const stateFilter = searchParams.get("state");
  const authorFilter = searchParams.get("author");
  const period = searchParams.get("period"); // 7d | 30d | 90d | all

  let admin: ReturnType<typeof createAdminClient>;
  let projectIds: string[];
  try {
    admin = createAdminClient();
    const scope = await resolveTenantScope(admin, user.id);
    projectIds = scope.projectIds;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { pull_requests: [], error: `Cannot resolve per-project access: ${message}` },
      { status: 503 }
    );
  }

  if (projectIds.length === 0) {
    return NextResponse.json({ pull_requests: [], counts: { total: 0, with_bugs: 0 }, bug_detection_rate: null });
  }

  const { data: projects } = await admin
    .from("projects")
    .select("id, repo_full_name")
    .in("id", projectIds);
  const repoByProject = new Map<string, string>(
    (projects || []).map((p: { id: string; repo_full_name: string }) => [p.id, p.repo_full_name])
  );

  let query = admin
    .from("pull_requests")
    .select("*")
    .in("project_id", projectIds)
    .order("opened_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (repoFilter) {
    query = query.eq("repo_full_name", repoFilter);
  }
  if (stateFilter && stateFilter !== "all") {
    query = query.eq("state", stateFilter);
  }
  if (authorFilter) {
    query = query.eq("author_login", authorFilter);
  }
  if (period && period !== "all") {
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("opened_at", since);
  }

  const { data: prs, error } = await query;
  if (error) {
    // A missing relation means the PR-centric migration has not been applied.
    // PostgREST reports this as PGRST205 ("could not find the table ... in the
    // schema cache"); a direct Postgres error would be 42P01.
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /relation .* does not exist|could not find the table|schema cache/i.test(error.message || "");
    if (missing) {
      return NextResponse.json({
        pull_requests: [],
        migration_required: true,
        error: "The pull-request tables are not present yet. Apply supabase/migrations/20260913000000_pr_centric_model.sql.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = prs || [];
  const runIds = rows.map((p: { latest_run_id: string | null }) => p.latest_run_id).filter(Boolean) as string[];

  const runById = new Map<string, { status: string; completed_at: string | null; created_at: string | null; result: any }>();
  const casesByRun = new Map<
    string,
    { status: string; severity: string | null; category: string | null; verified: boolean }[]
  >();

  if (runIds.length > 0) {
    const [{ data: runs }, { data: cases }] = await Promise.all([
      admin.from("runs").select("id, status, completed_at, created_at, result").in("id", runIds),
      admin.from("test_cases").select("run_id, status, severity, category, verified_this_commit").in("run_id", runIds),
    ]);
    for (const run of runs || []) {
      runById.set(run.id, run);
    }
    for (const testCase of cases || []) {
      const list = casesByRun.get(testCase.run_id) || [];
      list.push({
        status: testCase.status,
        severity: testCase.severity,
        category: testCase.category,
        verified: testCase.verified_this_commit !== false,
      });
      casesByRun.set(testCase.run_id, list);
    }
  }

  let prsWithBugs = 0;
  const mapped = rows.map((pr: any) => {
    const run = pr.latest_run_id ? runById.get(pr.latest_run_id) : undefined;
    const cases = pr.latest_run_id ? casesByRun.get(pr.latest_run_id) || [] : [];
    // Only a failure actually verified on this commit counts as a regression
    // for this PR. Carried-forward failures are reported separately so an
    // inherited bug cannot be attributed to the change.
    const verified = cases.filter((c) => c.verified);
    const failures = verified.filter((c) => c.status === "failed");
    const carried = cases.filter((c) => !c.verified);
    const counts = emptyCounts();
    for (const failure of failures) {
      const severity = (failure.severity || "medium").toLowerCase();
      if ((SEVERITY_LEVELS as readonly string[]).includes(severity)) counts[severity] += 1;
    }
    const hasBugs = failures.length > 0;
    if (hasBugs) prsWithBugs += 1;

    return {
      id: pr.id,
      repo_full_name: pr.repo_full_name,
      repo_label: repoByProject.get(pr.project_id) || pr.repo_full_name,
      pr_number: pr.pr_number,
      title: pr.title,
      author_login: pr.author_login,
      author_type: pr.author_type,
      state: pr.state,
      is_draft: pr.is_draft,
      head_branch: pr.head_branch,
      base_branch: pr.base_branch,
      head_sha: pr.head_sha,
      html_url: pr.html_url,
      opened_at: pr.opened_at,
      tested_at: pr.tested_at,
      added_lines: pr.added_lines,
      removed_lines: pr.removed_lines,
      changed_files: pr.changed_files,
      run: run
        ? {
            id: pr.latest_run_id,
            status: run.status,
            completed_at: run.completed_at,
            created_at: run.created_at,
            result_status: run.result?.status ?? null,
            change_impact: run.result?.change_impact?.kind ?? null,
          }
        : null,
      counts: {
        ...counts,
        passed: verified.filter((c) => c.status === "passed").length,
        failed: failures.length,
        skipped: verified.filter((c) => c.status === "skipped").length,
        verified_total: verified.length,
        carried_forward: carried.length,
        carried_forward_failing: carried.filter((c) => c.status === "failed").length,
        total: cases.length,
      },
      has_bugs: hasBugs,
      highest_severity:
        SEVERITY_LEVELS.find((level) => counts[level] > 0) || null,
    };
  });

  return NextResponse.json({
    pull_requests: mapped,
    counts: { total: mapped.length, with_bugs: prsWithBugs },
    // Null, never 0%, when nothing has been tested: an untested fleet has no
    // detection rate rather than a perfect one.
    bug_detection_rate:
      mapped.length > 0 ? Math.round((prsWithBugs / mapped.length) * 1000) / 10 : null,
  });
}
