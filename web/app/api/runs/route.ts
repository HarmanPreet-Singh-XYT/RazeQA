import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

import { execSync } from "child_process";

function getGitInfo(): { sha: string; branch: string } {
  let sha = "HEAD";
  let branch = "main";
  try {
    sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {}
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    if (branch === "HEAD") branch = "main";
  } catch {}
  return { sha, branch };
}

import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canAccessRepo, resolveTenantScope, type TenantScope } from "@/lib/tenant";
import { refreshRunArtifactUrls } from "@/lib/supabase/storage-urls";

/**
 * The engine labels every record `repo: "default"` and keeps the real
 * repository in `result.owner` / `result.repo`. Without resolving it, the tenant
 * filter below compares "default" against the caller's repositories, matches
 * nothing, and every unscoped runs feed (the workspace overview's "Recent
 * Previews & Runs" and its per-project "Check last run" button) renders empty.
 */
function resolveRunRepo(run: any): string | null {
  const direct = run?.repo_full_name || run?.repo;
  if (typeof direct === "string" && direct && direct !== "default") return direct;

  const result = run?.result || {};
  const name = result.repo_full_name || result.repo;
  if (typeof name === "string" && name) {
    if (name.includes("/")) return name;
    const owner = result.owner || run?.owner;
    if (typeof owner === "string" && owner) return `${owner}/${name}`;
  }

  return typeof direct === "string" && direct ? direct : null;
}

export async function GET(request: Request) {
  const git = getGitInfo();
  const { searchParams } = new URL(request.url);
  const repoParam = searchParams.get("repo");
  const branchParam = searchParams.get("branch");

  // Resolve the caller's tenant scope before returning anything. The engine has
  // no per-user scoping of its own, so this route is the only place that can
  // stop one signed-in user from reading another tenant's runs.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { runs: [], engineConnected: false, git, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  let scope: TenantScope;
  try {
    admin = createAdminClient();
    scope = await resolveTenantScope(admin, user.id);
  } catch (err: any) {
    // Without elevated DB access we cannot determine what this user may see.
    // Fail closed with a clear message rather than returning every run.
    return NextResponse.json(
      {
        runs: [],
        engineConnected: false,
        git,
        error: `Cannot resolve per-project access: ${err?.message ?? "unknown error"}`,
      },
      { status: 503 }
    );
  }

  // Asking for a repository outside the caller's scope is answered with an
  // empty list, never with a hint that the repo exists.
  if (repoParam && !canAccessRepo(scope, repoParam)) {
    return NextResponse.json(
      { runs: [], engineConnected: true, git, warning: "No access to the requested repository." },
      { status: 403 }
    );
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { runs: [], engineConnected: false, git, error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 200 }
    );
  }
  try {
    const queryString = searchParams.toString();
    const targetUrl = queryString ? `${ENGINE_URL}/runs?${queryString}` : `${ENGINE_URL}/runs`;

    const res = await fetch(targetUrl, {
      method: "GET",
      headers: engineHeaders(),
      cache: "no-store",
    });

    if (res.ok) {
      const payload = await res.json();
      const allRuns = Array.isArray(payload) ? payload : [];
      const runs = allRuns
        .map((r: any) => {
          const repo = resolveRunRepo(r);
          if (!repo || repo === r.repo) return r;
          // Surface the real repository so the dashboard can label and group the
          // run instead of keying it under "default".
          return { ...r, repo, repo_full_name: r.repo_full_name || repo };
        })
        .filter((r: any) => canAccessRepo(scope, r?.repo ?? r?.repo_full_name));
      return NextResponse.json({
        runs,
        engineConnected: true,
        git,
        ...(scope.repoNames.length === 0 && !scope.includeUnowned
          ? { warning: "No projects imported for this account; no runs to show." }
          : {}),
      });
    }
  } catch (err: any) {
    // Engine daemon offline - fall through to Supabase direct query
  }

  // Fallback: Direct Supabase query if engine is offline or returned error
  try {
    if (scope.projectIds.length === 0 && !scope.includeUnowned) {
      return NextResponse.json({
        runs: [],
        engineConnected: false,
        git,
        warning: "No projects imported for this account; no runs to show.",
      });
    }

    let query = admin.from("runs").select("*").order("created_at", { ascending: false });
    if (branchParam) {
      query = query.eq("branch", branchParam);
    }
    if (!scope.includeUnowned) {
      query = query.in("project_id", scope.projectIds);
    }
    // The engine honours `?repo=`; this fallback must too. Without it a
    // project-scoped page showed every run in the tenant (each one stamped
    // with the requested repo, so the client-side filter could not tell).
    if (repoParam) {
      const { data: repoProjects } = await admin
        .from("projects")
        .select("id")
        .eq("repo_full_name", repoParam);
      const repoProjectIds = (repoProjects || [])
        .map((p: { id?: string }) => p.id)
        .filter((id): id is string => Boolean(id));
      if (repoProjectIds.length === 0) {
        return NextResponse.json({
          runs: [],
          engineConnected: false,
          git,
          warning: "No stored runs for the requested repository.",
        });
      }
      query = query.in("project_id", repoProjectIds);
    }
    const { data: dbRuns, error: dbError } = await query;
    if (!dbError && dbRuns && dbRuns.length > 0) {
      // Runs only store `project_id`; resolve the repo so the client can label
      // and filter each run by its real project instead of a placeholder.
      const runProjectIds = Array.from(
        new Set(dbRuns.map((r: any) => r.project_id).filter(Boolean))
      );
      const repoByProjectId: Record<string, string> = {};
      if (runProjectIds.length > 0) {
        const { data: runProjects } = await admin
          .from("projects")
          .select("id, repo_full_name")
          .in("id", runProjectIds);
        for (const p of runProjects || []) {
          if (p?.id) repoByProjectId[p.id] = p.repo_full_name;
        }
      }
      // Supabase Storage signed URLs expire an hour after issue; a run listed
      // later than that would otherwise hand back a dead video/trace link.
      const refreshed = await Promise.all(
        dbRuns.map((r: any) => refreshRunArtifactUrls(admin, r))
      );
      const mapped = refreshed.map((r: any) => ({
        id: r.id,
        run_id: r.id,
        branch: r.branch,
        sha: r.sha,
        repo: repoByProjectId[r.project_id] || repoParam || "default",
        scope: r.scope || "changed",
        test_type: r.test_type || "functional",
        status: r.status || "queued",
        result: r.result || {},
        video_url: r.video_url,
        trace_url: r.trace_url,
        pr_number: r.github_pr_number,
        created_at: r.created_at,
        completed_at: r.completed_at,
      }));
      return NextResponse.json({ runs: mapped, engineConnected: false, git });
    }
  } catch {}

  return NextResponse.json(
    { runs: [], engineConnected: false, git, warning: "Engine daemon offline at localhost:8000" },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { status: "failed", error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();

    // Normalize: UI sends repo_full_name (e.g. "owner/repo"), Python expects "repo".
    if (body.repo_full_name && !body.repo) {
      body.repo = body.repo_full_name;
      delete body.repo_full_name;
    }

    if (!body.url) {
      // For a real GitHub repo (contains "/"), resolve the latest SHA from
      // the GitHub API so we test the actual repo's HEAD — NOT the local
      // Next.js server git (which is this monorepo's SHA, unrelated to the
      // selected project).
      const repoFullName: string = body.repo || "";
      const isGitHubRepo = repoFullName.includes("/") &&
        !repoFullName.startsWith("local") &&
        !repoFullName.startsWith("default");

      if (isGitHubRepo && (!body.sha || body.sha === "HEAD")) {
        const branch = body.branch || "main";
        try {
          const ghRes = await fetch(
            `https://api.github.com/repos/${repoFullName}/commits/${branch}`,
            {
              headers: {
                Accept: "application/vnd.github.sha",
                ...(process.env.GITHUB_TOKEN
                  ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
                  : {}),
              },
              cache: "no-store",
            }
          );
          if (ghRes.ok) {
            body.sha = (await ghRes.text()).trim();
          }
        } catch {
          // GitHub API unavailable — fall through to HEAD as a last resort
        }
      }

      // Final fallback: use local git HEAD (only meaningful for local dev repos)
      if (!body.sha || body.sha === "HEAD") {
        const git = getGitInfo();
        body.sha = git.sha;
        if (!body.branch) body.branch = git.branch;
      }

      if (!body.branch) body.branch = "main";
    }

    const targetEndpoint = body.url ? `${ENGINE_URL}/runs/external` : `${ENGINE_URL}/runs`;
    const res = await fetch(targetEndpoint, {
      method: "POST",
      headers: engineHeaders(),
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        status: "failed",
        error: "Could not reach PR Testing Engine. Please ensure the backend is running.",
      },
      { status: 503 }
    );
  }
}
