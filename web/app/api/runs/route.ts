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

export async function GET(request: Request) {
  const git = getGitInfo();
  const { searchParams } = new URL(request.url);
  const repoParam = searchParams.get("repo");
  const branchParam = searchParams.get("branch");

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
      const runs = await res.json();
      return NextResponse.json({ runs, engineConnected: true, git });
    }
  } catch (err: any) {
    // Engine daemon offline - fall through to Supabase direct query
  }

  // Fallback: Direct Supabase query if engine is offline or returned error
  try {
    const supabase = createAdminClient();
    let query = supabase.from("runs").select("*").order("created_at", { ascending: false });
    if (branchParam) {
      query = query.eq("branch", branchParam);
    }
    const { data: dbRuns, error: dbError } = await query;
    if (!dbError && dbRuns && dbRuns.length > 0) {
      const mapped = dbRuns.map((r: any) => ({
        id: r.id,
        run_id: r.id,
        branch: r.branch,
        sha: r.sha,
        repo: repoParam || "default",
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
