import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";

/**
 * Dispatch verification for manually selected pull requests.
 *
 * Each selection is recorded in `pull_requests` first, so the PR-centric views
 * know about it immediately, and then a run is dispatched for that PR's head
 * commit. Runs are queued by the engine, not fired in parallel here.
 */

export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

/** The engine allows 10 forced runs per minute per repository. */
const MAX_SELECTION = 10;

interface SelectedPR {
  pr_number: number;
  title?: string;
  author_login?: string;
  author_type?: string;
  is_draft?: boolean;
  head_branch?: string;
  head_sha?: string;
  base_branch?: string;
  html_url?: string;
  additions?: number | null;
  deletions?: number | null;
  changed_files?: number | null;
  opened_at?: string;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set for the web app." },
      { status: 503 }
    );
  }

  let body: {
    repo_full_name?: string;
    scope?: string;
    test_type?: string;
    pull_requests?: SelectedPR[];
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const repo = (body.repo_full_name || "").trim();
  const selections = Array.isArray(body.pull_requests) ? body.pull_requests : [];
  if (!repo || selections.length === 0) {
    return NextResponse.json(
      { error: "repo_full_name and at least one pull request are required." },
      { status: 400 }
    );
  }
  if (selections.length > MAX_SELECTION) {
    return NextResponse.json(
      { error: `Select at most ${MAX_SELECTION} pull requests at a time.` },
      { status: 400 }
    );
  }

  const scope = body.scope === "full" ? "full" : "changed";
  const testType = body.test_type === "functional + visual" ? "functional + visual" : "functional";

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, repo_full_name, user_id")
    .eq("repo_full_name", repo)
    .maybeSingle();

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const selection of selections) {
    const prNumber = Number(selection.pr_number);
    if (!Number.isFinite(prNumber)) {
      results.push({ pr_number: selection.pr_number, status: "skipped", error: "Invalid PR number." });
      continue;
    }

    const headSha = (selection.head_sha || "").trim();
    const branch = (selection.head_branch || "").trim();

    // Record the selection before dispatching so the PR appears in the
    // dashboard even if the run cannot be queued.
    try {
      await admin.from("pull_requests").upsert(
        {
          project_id: project.id,
          repo_full_name: repo,
          pr_number: prNumber,
          title: selection.title ?? null,
          author_login: selection.author_login ?? null,
          author_type: (selection.author_type || "User").toLowerCase() === "bot" ? "bot" : "user",
          state: "open",
          is_draft: Boolean(selection.is_draft),
          head_branch: branch || null,
          base_branch: selection.base_branch || "main",
          head_sha: headSha || null,
          html_url: selection.html_url ?? null,
          // Column names on pull_requests are added_lines / removed_lines.
          added_lines: selection.additions ?? null,
          removed_lines: selection.deletions ?? null,
          changed_files: selection.changed_files ?? null,
          opened_at: selection.opened_at ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "repo_full_name,pr_number" }
      );
    } catch (err) {
      // Non-fatal: the run can still be dispatched.
      console.error(`Could not record pull request ${repo}#${prNumber}:`, err);
    }

    if (!headSha || !branch) {
      results.push({
        pr_number: prNumber,
        status: "skipped",
        error: "Pull request is missing its head commit; refresh and retry.",
      });
      continue;
    }

    try {
      const res = await fetch(`${ENGINE_URL}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENGINE_API_KEY}`,
        },
        body: JSON.stringify({
          repo,
          branch,
          sha: headSha,
          pr_number: prNumber,
          scope,
          test_type: testType,
          force: true,
          trigger: "manual-selection",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({
          pr_number: prNumber,
          status: "failed",
          error: data?.detail || data?.error || `Engine rejected the run (HTTP ${res.status}).`,
        });
        continue;
      }
      results.push({
        pr_number: prNumber,
        status: data?.status || "queued",
        run_id: data?.run_id ?? null,
      });
    } catch (err: any) {
      results.push({
        pr_number: prNumber,
        status: "failed",
        error: err?.message || "Could not reach the AutoQA engine.",
      });
    }
  }

  const queued = results.filter((r) => r.run_id).length;
  return NextResponse.json({
    repo_full_name: repo,
    scope,
    test_type: testType,
    requested: selections.length,
    queued,
    results,
  });
}
