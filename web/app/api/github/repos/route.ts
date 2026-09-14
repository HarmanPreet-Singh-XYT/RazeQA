import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverRepositories } from "@/lib/github/discovery";
import { resolveGitHubConnection } from "@/lib/github/connection";

/**
 * List repositories made available by the GitHub App installation(s) **that the
 * signed-in user owns**.
 *
 * This endpoint exists to populate the *import* picker, so it deliberately does
 * NOT create anything. Repositories are annotated with `imported`, which the UI
 * uses to separate "available to import" from "already connected". A `projects`
 * row is only ever created by an explicit POST /api/projects from the import
 * flow.
 *
 * When the deployment has a GitHub App but the caller has not connected it, the
 * response is a 200 carrying `github_app_connected: false` plus `connect_url`.
 * That is not an error state — it is a required step — and the import screen
 * renders it as such instead of as an empty repository list. Returning 4xx here
 * would make "connect the App" indistinguishable from "GitHub is down".
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `installations` is service-role-only under RLS, so connection resolution
  // needs the elevated client. It is also the client used for the `imported`
  // annotation below.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Supabase admin client unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const connection = await resolveGitHubConnection(admin, user);

  if (!connection.connected) {
    return NextResponse.json({
      github_app_connected: false,
      app_configured: connection.appConfigured,
      connect_url: connection.connectUrl,
      reason: connection.reason,
      // An account with no linked GitHub identity cannot be matched to an
      // installation by ownership, so the UI must say so rather than loop the
      // user through an install that can never resolve.
      github_identity_linked: connection.githubIdentityLinked,
      github_login: connection.githubLogin,
      repositories: [],
      count: 0,
      imported_count: 0,
    });
  }

  // Scope the union-of-all-installations catalogue down to this user's own
  // installations. This filter is the tenant boundary, not the UI.
  const discovered = await discoverRepositories(admin, {
    installationIds: connection.installationIds,
  });

  // Annotate with import state using the elevated client (the projects table is
  // RLS-protected and the picker needs a truthful "already imported" flag).
  let importedNames = new Set<string>();
  try {
    const { data: projects } = await admin.from("projects").select("repo_full_name");
    importedNames = new Set(
      (projects || []).map((p: { repo_full_name?: string }) => String(p.repo_full_name).toLowerCase())
    );
  } catch (err) {
    console.error("Failed to resolve imported project state:", err);
  }

  const repositories = discovered.map((r) => ({
    ...r,
    imported: importedNames.has(r.repo_full_name.toLowerCase()),
  }));

  return NextResponse.json({
    github_app_connected: true,
    app_configured: connection.appConfigured,
    connect_url: connection.connectUrl,
    reason: connection.reason,
    installations: connection.installations,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent platform service unreachable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
