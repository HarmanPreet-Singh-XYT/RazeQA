import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canAccessRepo, resolveTenantScope } from "@/lib/tenant";

/**
 * List pull requests for an imported repository so a person can pick which
 * ones to verify. Read-only: selecting and dispatching is a separate call.
 */

export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const repo = (searchParams.get("repo") || "").trim();
  const state = (searchParams.get("state") || "open").trim();
  if (!repo) {
    return NextResponse.json({ error: "repo is required." }, { status: 400 });
  }

  // A caller may only read PRs for a repository they have imported.
  try {
    const admin = createAdminClient();
    const scope = await resolveTenantScope(admin, user.id);
    if (!canAccessRepo(scope, repo)) {
      return NextResponse.json({ error: "Repository not found for this account." }, { status: 404 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Cannot resolve access: ${message}` }, { status: 503 });
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set for the web app." },
      { status: 503 }
    );
  }

  try {
    const params = new URLSearchParams({ repo, state });
    const res = await fetch(`${ENGINE_URL}/api/github/pull-requests?${params.toString()}`, {
      headers: { Authorization: `Bearer ${ENGINE_API_KEY}` },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.detail || data?.error || `Could not list pull requests (HTTP ${res.status}).` },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Could not reach the RazeQA engine." },
      { status: 503 }
    );
  }
}
