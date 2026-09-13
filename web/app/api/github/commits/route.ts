import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canAccessRepo, resolveTenantScope } from "@/lib/tenant";

/**
 * List recent commits for a repository the caller owns.
 *
 * This exists for the first-run briefing's commit picker: choosing "just this
 * commit" or "this range of commits" needs real SHAs from the repo under test,
 * and the engine holds the GitHub App installation token that can read them.
 *
 * Access is checked against the caller's imported projects *before* the engine
 * is called, so an unowned repository name can never be used to probe GitHub
 * through this deployment.
 */
const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const repo = (searchParams.get("repo") || "").trim();
  const ref = (searchParams.get("ref") || "").trim() || null;

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return NextResponse.json(
      { error: "repo must be in 'owner/repository' form." },
      { status: 400 }
    );
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set.", commits: [] },
      { status: 503 }
    );
  }

  let installationId: number | null = null;
  try {
    const admin = createAdminClient();
    const scope = await resolveTenantScope(admin, user.id);
    if (!canAccessRepo(scope, repo)) {
      // Answer as if the repository were unknown rather than confirming that
      // some other tenant has it imported.
      return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
    }

    const { data } = await admin
      .from("projects")
      .select("installation_id")
      .eq("repo_full_name", repo)
      .maybeSingle();
    installationId = data?.installation_id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not resolve project access.";
    return NextResponse.json({ error: message, commits: [] }, { status: 503 });
  }

  const params = new URLSearchParams({ repo, per_page: "50" });
  if (ref) params.set("ref", ref);
  if (installationId !== null) params.set("installation_id", String(installationId));

  try {
    const res = await fetch(`${ENGINE_URL}/api/github/commits?${params.toString()}`, {
      headers: {
        "Content-Type": "application/json",
        ...(ENGINE_API_KEY ? { Authorization: `Bearer ${ENGINE_API_KEY}` } : {}),
      },
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.detail || data?.error || `Failed to list commits (HTTP ${res.status}).`, commits: [] },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Could not reach the PR Testing Engine to list commits.", commits: [] },
      { status: 503 }
    );
  }
}
