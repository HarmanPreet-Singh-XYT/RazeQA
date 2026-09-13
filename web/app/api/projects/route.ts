import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { showUnownedProjects } from "@/lib/tenant";
import type { User } from "@supabase/supabase-js";

/**
 * Optional columns that require the `supabase/migrations` schema to be applied.
 * Older deployments may not have them yet; we transparently retry without them
 * instead of surfacing a raw Postgres `column does not exist` error in the UI.
 */
const OPTIONAL_PROJECT_COLUMNS = ["default_branch", "imported_at"] as const;

/** Postgres undefined-column (42703) and PostgREST schema-cache (PGRST204) codes. */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message || "");
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Remove optional columns named in a missing-column error from the payload so
 * the write can succeed against an older schema. Returns how many were removed;
 * 0 means the error did not identify a column we know how to drop.
 */
function stripMissingOptionalColumns(
  payload: Record<string, unknown>,
  message: string | undefined
): number {
  const lower = (message || "").toLowerCase();
  let removed = 0;
  for (const column of OPTIONAL_PROJECT_COLUMNS) {
    if (column in payload && lower.includes(column.toLowerCase())) {
      delete payload[column];
      removed += 1;
    }
  }
  return removed;
}

/**
 * Resolve the signed-in user, or null when there is no verified Supabase
 * session. There is deliberately NO auth bypass here: the previous
 * `isDevNoAuth` escape hatch meant that a misconfigured dev deployment would
 * write unowned rows that no user could ever see or manage.
 */
async function getAuthenticatedUser(supabase: SupabaseServerClient): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/**
 * A repo may only be imported when it is reachable through one of the
 * installations this deployment knows about. If no installations are recorded
 * at all (GitHub App not configured, or a manually-entered repo), we allow the
 * import — otherwise the platform would be unusable without the App.
 */
async function isRepoReachableByInstallations(
  supabase: SupabaseServerClient,
  repoFullName: string
): Promise<{ allowed: boolean; installationId: number | null }> {
  const { data: installations, error } = await supabase
    .from("installations")
    .select("installation_id, repositories");

  if (error || !installations || installations.length === 0) {
    return { allowed: true, installationId: null };
  }

  const needle = repoFullName.toLowerCase();
  for (const inst of installations) {
    const repos = Array.isArray(inst.repositories) ? inst.repositories : [];
    for (const r of repos) {
      const full = String(r?.full_name || r?.name || "").toLowerCase();
      if (full === needle) {
        return { allowed: true, installationId: inst.installation_id ?? null };
      }
    }
  }

  return { allowed: false, installationId: null };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: sign in to list projects." },
        { status: 401 }
      );
    }

    const admin = createAdminClient();
    // Scope to projects this user owns. Agent/webhook-created rows have
    // `user_id IS NULL`; exposing those to every signed-in user was the
    // cross-tenant leak this closes. `SHOW_UNOWNED_PROJECTS=true` restores the
    // old behaviour for single-tenant deployments.
    const includeUnowned = showUnownedProjects();
    const baseQuery = admin
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    const { data: projects, error } = await (includeUnowned
      ? baseQuery.or(`user_id.eq.${user.id},user_id.is.null`)
      : baseQuery.eq("user_id", user.id));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // When strict scoping hides ownerless (agent/webhook-created) projects,
    // report how many so the UI can explain the empty state instead of looking
    // broken. Zero in the common case.
    let hiddenUnownedProjects = 0;
    if (!includeUnowned) {
      const { count } = await admin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .is("user_id", null);
      hiddenUnownedProjects = count ?? 0;
    }

    return NextResponse.json({
      projects: projects || [],
      hidden_unowned_projects: hiddenUnownedProjects,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list projects.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const SAFE_BUILD_BINARIES = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "pytest",
  "python",
  "python3",
  "cargo",
  "go",
  "make",
];

const REPO_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Delete an imported project and its stored run history.
 *
 * Deletion is owner-scoped and permanent: `projects` has no soft-delete column,
 * so re-importing the same repository is the only way back. The row's run
 * history is removed first because `runs.project_id` cascades from `projects`
 * anyway — doing it explicitly lets us report how many runs went with it, and
 * keeps the operation legible in the response.
 *
 * Unknown and unowned projects both answer 404 so the endpoint never confirms
 * the existence of another tenant's repository.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: sign in to delete a project." },
        { status: 401 }
      );
    }

    let body: { repo_full_name?: string; id?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Fall through to the query-string form below.
    }

    const { searchParams } = new URL(request.url);
    const repoFullName = (body.repo_full_name || searchParams.get("repo") || "").trim();
    const projectId = (body.id || searchParams.get("id") || "").trim();

    if (!repoFullName && !projectId) {
      return NextResponse.json(
        { error: "Provide repo_full_name or id of the project to delete." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Resolve the row first so ownership is checked before anything is removed.
    let lookup = admin.from("projects").select("id, repo_full_name, user_id");
    lookup = repoFullName ? lookup.eq("repo_full_name", repoFullName) : lookup.eq("id", projectId);
    const { data: project, error: lookupError } = await lookup.maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }
    if (!project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: "Project not found for this account." },
        { status: 404 }
      );
    }

    const { count: runCount } = await admin
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id);
    if (runCount) {
      await admin.from("runs").delete().eq("project_id", project.id);
    }

    const { error: deleteError } = await admin.from("projects").delete().eq("id", project.id);
    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete project: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "deleted",
      repo_full_name: project.repo_full_name,
      deleted_runs: runCount ?? 0,
      // The dashboard holds the active selection and project list in React
      // state; tell it to re-resolve rather than leave a dangling selection.
      refresh_required: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Recursively merge a settings patch into existing settings.
 *
 * Only plain objects are merged; arrays and scalars replace wholesale. Settings
 * are written as a single JSON blob, so a top-level replace would let a caller
 * that only knows about `first_run` erase the build command, personas, and
 * auto-repair policy it never sent.
 */
function mergeSettings(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      merged[key] = mergeSettings(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate user session and resolve the owning user id.
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: You must be logged in to import or modify a project." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { repo_full_name, settings } = body ?? {};

    if (typeof repo_full_name !== "string" || !repo_full_name.trim()) {
      return NextResponse.json({ error: "repo_full_name is required" }, { status: 400 });
    }

    const repoFullName = repo_full_name.trim();
    if (!REPO_FULL_NAME_PATTERN.test(repoFullName)) {
      return NextResponse.json(
        { error: "repo_full_name must be in 'owner/repository' form." },
        { status: 400 }
      );
    }

    const requestedBranch =
      typeof body?.default_branch === "string" && body.default_branch.trim()
        ? body.default_branch.trim()
        : undefined;

    // 2. Only repos this deployment can actually reach may be imported.
    const access = await isRepoReachableByInstallations(supabase, repoFullName);
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            `Repository '${repoFullName}' is not available to this account. ` +
            "Install the AutoQA GitHub App on it, or grant it access in GitHub, then retry.",
        },
        { status: 403 }
      );
    }

    // 3. Server-side command-injection validation (Fix Finding #4)
    const buildCmd = (settings?.auto_repair?.build_command || "").trim();
    if (buildCmd) {
      for (const op of [";", "&&", "||", "|", "`", "$", "\n", "\r", ">", "<"]) {
        if (buildCmd.includes(op)) {
          return NextResponse.json(
            { error: `Invalid build_command: contains disallowed operator '${op}'` },
            { status: 400 }
          );
        }
      }
      const binary = buildCmd.split(/\s+/)[0]?.replace(/^.*\//, "");
      if (binary && !SAFE_BUILD_BINARIES.includes(binary)) {
        return NextResponse.json(
          { error: `Invalid build_command: binary '${binary}' is not permitted.` },
          { status: 400 }
        );
      }
    }

    // 4. Writes go through the elevated client. The projects table is protected
    //    by RLS, which only admits the service role (or the row's own owner via
    //    the policies in supabase/migrations). Using the request's publishable
    //    key here is what produced `new row violates row-level security policy`.
    const admin = createAdminClient();

    // 5. Credential-clobbering protection (Fix Finding #2) and ownership check.
    // `repo_full_name` is globally unique, so an upsert keyed on it would let any
    // signed-in user silently take over an existing project — including its
    // stored credentials — just by importing the same repo. Refuse that.
    const { data: existingProject } = await admin
      .from("projects")
      .select("settings, user_id")
      .eq("repo_full_name", repoFullName)
      .maybeSingle();

    if (existingProject?.user_id && existingProject.user_id !== user.id) {
      return NextResponse.json(
        { error: `Repository '${repoFullName}' is already imported by another account.` },
        { status: 403 }
      );
    }

    const mergedSettings = { ...(settings || {}) };
    if (existingProject?.settings?.roles && mergedSettings.roles) {
      const existingRoles = existingProject.settings.roles;
      for (const [rKey, rVal] of Object.entries(mergedSettings.roles as Record<string, any>)) {
        if (!rVal.password || rVal.password === "••••••••••••") {
          const preserved = existingRoles[rKey]?.password;
          if (preserved && preserved !== "••••••••••••") {
            rVal.password = preserved;
          }
        }
      }
    }

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      repo_full_name: repoFullName,
      settings: mergedSettings,
      user_id: user.id,
      updated_at: nowIso,
    };
    if (access.installationId !== null) {
      payload.installation_id = access.installationId;
    }
    if (requestedBranch) {
      payload.default_branch = requestedBranch;
    }
    // Only stamp the import time on first import so re-saving settings does not
    // masquerade as a fresh import.
    if (!existingProject) {
      payload.imported_at = nowIso;
    }

    const upsert = () =>
      admin.from("projects").upsert(payload, { onConflict: "repo_full_name" }).select();

    // Retry without schema-dependent optional columns if the migration has not
    // been applied to this database yet.
    let response = await upsert();
    for (let attempt = 0; attempt < OPTIONAL_PROJECT_COLUMNS.length; attempt++) {
      if (!response.error || !isMissingColumnError(response.error)) break;
      const missing = stripMissingOptionalColumns(payload, response.error.message);
      if (missing === 0) break;
      response = await upsert();
    }

    const { data, error } = response;
    if (error) {
      console.error("Failed to upsert project:", error);
      return NextResponse.json(
        { error: `Failed to save project: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: "saved", project: data?.[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Merge a partial `settings` patch into an owned project.
 *
 * Unlike POST (which replaces settings wholesale and is the import/save path),
 * PATCH is for small, targeted updates from the dashboard — currently the
 * "first verification has been dispatched" marker the first-run briefing
 * records. It refuses to create a project: patching a repository that was never
 * imported is a 404, not an implicit import.
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: sign in to update a project." },
        { status: 401 }
      );
    }

    let body: { repo_full_name?: string; id?: string; settings?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
    }

    const repoFullName = (body.repo_full_name || "").trim();
    const projectId = (body.id || "").trim();
    if (!repoFullName && !projectId) {
      return NextResponse.json(
        { error: "Provide repo_full_name or id of the project to update." },
        { status: 400 }
      );
    }
    if (!isPlainObject(body.settings)) {
      return NextResponse.json(
        { error: "settings must be a JSON object." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    let lookup = admin.from("projects").select("id, repo_full_name, user_id, settings");
    lookup = repoFullName
      ? lookup.eq("repo_full_name", repoFullName)
      : lookup.eq("id", projectId);
    const { data: project, error: lookupError } = await lookup.maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }
    if (!project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: "Project not found for this account." },
        { status: 404 }
      );
    }

    const existingSettings = isPlainObject(project.settings) ? project.settings : {};
    const merged = mergeSettings(existingSettings, body.settings);

    const { data, error } = await admin
      .from("projects")
      .update({ settings: merged, updated_at: new Date().toISOString() })
      .eq("id", project.id)
      .select();

    if (error) {
      return NextResponse.json(
        { error: `Failed to update project: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: "updated", project: data?.[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
