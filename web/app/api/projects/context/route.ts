import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret, secretsConfigured } from "@/lib/secrets";

/**
 * Per-repository Context & Secrets: variables, secrets and seed data.
 *
 * Secrets are write-only. The value is encrypted here and the GET response only
 * ever exposes the name, description and the fact that it is encrypted — the
 * plaintext cannot be read back through the API or the UI.
 */

export const dynamic = "force-dynamic";

const KINDS = new Set(["variable", "secret", "seed"]);

async function resolveProject(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  repoFullName: string
) {
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
    .from("project_context")
    .select("id, kind, name, value, encrypted, description, updated_at")
    .eq("project_id", project.id)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /relation .* does not exist|could not find the table|schema cache/i.test(error.message || "");
    if (missing) {
      return NextResponse.json({
        entries: [],
        secrets_configured: secretsConfigured(),
        migration_required: true,
        error: "The project_context table is not present yet. Apply supabase/migrations/20260913000000_pr_centric_model.sql.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (data || []).map((row: any) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    // A secret value is never returned. Variables and seed data are plaintext
    // by definition and are needed for editing.
    value: row.kind === "secret" ? null : row.value,
    encrypted: row.encrypted,
    description: row.description,
    updated_at: row.updated_at,
  }));

  return NextResponse.json({ entries, secrets_configured: secretsConfigured() });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { repo?: string; kind?: string; name?: string; value?: string; description?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const repo = (body.repo || "").trim();
  const kind = (body.kind || "").trim().toLowerCase();
  const name = (body.name || "").trim();
  const value = body.value ?? "";

  if (!repo || !KINDS.has(kind)) {
    return NextResponse.json({ error: "repo and a valid kind (variable|secret|seed) are required." }, { status: 400 });
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return NextResponse.json(
      { error: "name must start with a letter or underscore and contain only letters, digits and underscores." },
      { status: 400 }
    );
  }
  if (!value) {
    return NextResponse.json({ error: "value is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const project = await resolveProject(admin, user.id, repo);
  if (!project) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  let storedValue = value;
  let encrypted = false;
  if (kind === "secret") {
    if (!secretsConfigured()) {
      return NextResponse.json(
        {
          error:
            "CREDENTIAL_STORE_KEY is not configured, so secrets cannot be stored. Set it to the same value the engine uses.",
        },
        { status: 503 }
      );
    }
    try {
      storedValue = encryptSecret(value);
      encrypted = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Encryption failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } else if (kind === "variable") {
    // Environment variable names are conventional upper snake case.
    // (The validation above already guarantees the shape.)
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("project_context")
    .upsert(
      {
        project_id: project.id,
        kind,
        name,
        value: storedValue,
        encrypted,
        description: (body.description || "").trim() || null,
        updated_at: nowIso,
      },
      { onConflict: "project_id,kind,name" }
    )
    .select("id, kind, name, encrypted, description, updated_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    status: "saved",
    entry: { ...(data || [])[0], value: kind === "secret" ? null : value },
  });
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
    .from("project_context")
    .delete()
    .eq("id", id)
    .eq("project_id", project.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: "deleted", id });
}
