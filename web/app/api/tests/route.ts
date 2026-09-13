import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";

/**
 * Saved regression tests: the opt-in, reusable suite for a repository.
 *
 * Generated test cases are not saved automatically — a suite that grows from
 * every run becomes noise. A person saves the flows worth protecting, and every
 * later run is instructed to exercise the enabled ones.
 */

export const dynamic = "force-dynamic";

const CATEGORIES = new Set([
  "happy_path",
  "logic",
  "edge",
  "adversarial",
  "accessibility",
  "mobile",
  "visual",
  "navigation",
  "build",
]);

/** Must match `saved_test_fingerprint` in the engine so both dedup identically. */
function fingerprint(name: string, route: string | null): string {
  const normalized = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  return crypto
    .createHash("sha256")
    .update(`${route || ""}|${normalized}`)
    .digest("hex")
    .slice(0, 32);
}

async function resolveProject(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  repoFullName: string
) {
  if (!repoFullName) return null;
  const { data } = await admin
    .from("projects")
    .select("id, repo_full_name, user_id")
    .eq("repo_full_name", repoFullName)
    .maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return data;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const repo = (searchParams.get("repo") || "").trim();
  if (!repo) return NextResponse.json({ error: "repo is required." }, { status: 400 });

  const admin = createAdminClient();
  const project = await resolveProject(admin, user.id, repo);
  if (!project) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  const { data, error } = await admin
    .from("saved_tests")
    .select("id, name, route, category, intent, preconditions, enabled, times_run, last_verified_at, source_run_id, created_at, updated_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /relation .* does not exist|could not find the table|schema cache/i.test(error.message || "");
    if (missing) {
      return NextResponse.json({
        tests: [],
        migration_required: true,
        error:
          "The saved_tests table is not present yet. Apply supabase/migrations/20260913000000_pr_centric_model.sql.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tests: data || [] });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    repo?: string;
    name?: string;
    route?: string | null;
    category?: string;
    intent?: string;
    preconditions?: string[];
    source_run_id?: string | null;
    source_case_id?: string | null;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const repo = (body.repo || "").trim();
  const name = (body.name || "").trim();
  if (!repo || !name) {
    return NextResponse.json({ error: "repo and name are required." }, { status: 400 });
  }
  const category = CATEGORIES.has(body.category || "") ? (body.category as string) : "happy_path";
  const route = (body.route || "").trim() || null;
  const preconditions = Array.isArray(body.preconditions)
    ? body.preconditions.map((p) => String(p)).filter(Boolean).slice(0, 20)
    : [];

  const admin = createAdminClient();
  const project = await resolveProject(admin, user.id, repo);
  if (!project) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  const fp = fingerprint(name, route);
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("saved_tests")
    .upsert(
      {
        project_id: project.id,
        repo_full_name: repo,
        name,
        route,
        category,
        intent: (body.intent || "").trim() || null,
        preconditions,
        source_run_id: body.source_run_id || null,
        source_case_id: body.source_case_id || null,
        enabled: true,
        created_by: user.id,
        fingerprint: fp,
        updated_at: nowIso,
      },
      { onConflict: "repo_full_name,fingerprint" }
    )
    .select("id, name, route, category, intent, preconditions, enabled, times_run, last_verified_at, created_at, updated_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: "saved", test: (data || [])[0] ?? null });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { repo?: string; id?: string; enabled?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const repo = (body.repo || "").trim();
  const id = (body.id || "").trim();
  if (!repo || !id || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "repo, id and enabled are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const project = await resolveProject(admin, user.id, repo);
  if (!project) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  const { data, error } = await admin
    .from("saved_tests")
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("project_id", project.id)
    .select("id, enabled");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Test not found for this project." }, { status: 404 });
  }
  return NextResponse.json({ status: "updated", test: data[0] });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const repo = (searchParams.get("repo") || "").trim();
  const id = (searchParams.get("id") || "").trim();
  if (!repo || !id) {
    return NextResponse.json({ error: "repo and id are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const project = await resolveProject(admin, user.id, repo);
  if (!project) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  const { error } = await admin
    .from("saved_tests")
    .delete()
    .eq("id", id)
    .eq("project_id", project.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "deleted", id });
}
