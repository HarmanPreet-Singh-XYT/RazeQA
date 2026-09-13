import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverRepositories } from "@/lib/github/discovery";

/**
 * List repositories made available by the GitHub App installation(s).
 *
 * This endpoint exists to populate the *import* picker, so it deliberately does
 * NOT create anything. Repositories are annotated with `imported`, which the UI
 * uses to separate "available to import" from "already connected". A `projects`
 * row is only ever created by an explicit POST /api/projects from the import
 * flow.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const discovered = await discoverRepositories(supabase);

  // Annotate with import state using the elevated client (the projects table is
  // RLS-protected and the picker needs a truthful "already imported" flag).
  let importedNames = new Set<string>();
  try {
    const admin = createAdminClient();
    const { data: projects } = await admin.from("projects").select("repo_full_name");
    importedNames = new Set(
      (projects || []).map((p: any) => String(p.repo_full_name).toLowerCase())
    );
  } catch (err) {
    console.error("Failed to resolve imported project state:", err);
  }

  const repositories = discovered.map((r) => ({
    ...r,
    imported: importedNames.has(r.repo_full_name.toLowerCase()),
  }));

  return NextResponse.json({
    repositories,
    count: repositories.length,
    imported_count: repositories.filter((r) => r.imported).length,
  });
}

export async function POST() {
  const platformUrl = process.env.PLATFORM_URL || "http://localhost:8000";
  const agentKey = process.env.AGENT_API_KEY;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(`${platformUrl}/api/github/sync`, {
      method: "POST",
      headers: {
        ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
      },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    } else {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.detail || "Failed to synchronize GitHub App repositories" },
        { status: res.status }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Agent platform service unreachable" },
      { status: 503 }
    );
  }
}
