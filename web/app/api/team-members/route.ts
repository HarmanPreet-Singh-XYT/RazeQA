import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";

/**
 * Team recipients for notification delivery.
 *
 * `team_members` is the primary recipient source the engine resolves (see
 * agent/src/agent/email/recipients.py). It had no writer, so it was always
 * empty and notifications fell back to the project owner. This route is that
 * writer.
 *
 * Access is scoped by ownership of the underlying GitHub installation: a caller
 * may only see or modify members of an organization that at least one of their
 * own imported projects belongs to. That mapping is `projects.installation_id`
 * → `installations.account_login`, the same identity the engine uses to resolve
 * recipients.
 */

export const dynamic = "force-dynamic";

const ROLES = ["admin", "manager", "member"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MemberRow {
  id?: string;
  org_login?: string;
  email?: string | null;
  role?: string | null;
  github_login?: string | null;
  seat_assigned?: boolean | null;
  user_id?: string | null;
  created_at?: string | null;
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim();
}

/** Organizations the caller owns at least one project in. */
async function resolveAllowedOrgs(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string[]> {
  const { data: projects } = await admin
    .from("projects")
    .select("installation_id")
    .eq("user_id", userId)
    .not("installation_id", "is", null);

  const installationIds = Array.from(
    new Set((projects || []).map((p: { installation_id?: number }) => p.installation_id).filter(Boolean))
  );
  if (installationIds.length === 0) return [];

  const { data: installations } = await admin
    .from("installations")
    .select("account_login")
    .in("installation_id", installationIds);

  return Array.from(
    new Set(
      (installations || [])
        .map((i: { account_login?: string }) => String(i.account_login || "").trim())
        .filter(Boolean)
    )
  );
}

function missingTable(message: string | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message || "");
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const orgs = await resolveAllowedOrgs(admin, user.id);
  const { searchParams } = new URL(request.url);
  const requestedOrg = (searchParams.get("org") || "").trim();

  if (requestedOrg && !orgs.includes(requestedOrg)) {
    // Never confirm whether the org exists — only that it is not in scope.
    return NextResponse.json(
      { orgs, members: [], error: "No access to the requested organization." },
      { status: 403 }
    );
  }

  if (orgs.length === 0) {
    return NextResponse.json({ orgs: [], members: [] });
  }

  let query = admin
    .from("team_members")
    .select("id, org_login, email, role, github_login, seat_assigned, user_id, created_at")
    .order("created_at", { ascending: true });
  if (requestedOrg) {
    query = query.eq("org_login", requestedOrg);
  } else {
    query = query.in("org_login", orgs);
  }

  const { data, error } = await query;
  if (error) {
    if (missingTable(error.message)) {
      return NextResponse.json({
        orgs,
        members: [],
        migration_required: true,
        error:
          "The team_members table is not present yet. Apply supabase/migrations/20260913000000_pr_centric_model.sql.",
      });
    }
    return NextResponse.json({ orgs, members: [], error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orgs, members: data || [] });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { org?: string; email?: string; role?: string; github_login?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const org = (body.org || "").trim();
  const email = normalizeEmail(body.email);
  const role = ROLES.includes(body.role || "") ? (body.role as string) : "member";

  if (!org || !email) {
    return NextResponse.json({ error: "org and email are required." }, { status: 400 });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 422 });
  }

  const admin = createAdminClient();
  const orgs = await resolveAllowedOrgs(admin, user.id);
  if (!orgs.includes(org)) {
    return NextResponse.json({ error: "No access to the requested organization." }, { status: 403 });
  }

  // Match case-insensitively in application code: an expression unique index
  // cannot be targeted by PostgREST's on_conflict, and an `ilike` pattern would
  // treat `_` (legal in an email) as a wildcard.
  const { data: existingRows, error: listError } = await admin
    .from("team_members")
    .select("id, org_login, email, role, github_login, seat_assigned, user_id, created_at")
    .eq("org_login", org);
  if (listError) {
    if (missingTable(listError.message)) {
      return NextResponse.json(
        {
          error:
            "The team_members table is not present yet. Apply supabase/migrations/20260913000000_pr_centric_model.sql.",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const match = (existingRows || []).find(
    (row: MemberRow) => normalizeEmail(row.email).toLowerCase() === email.toLowerCase()
  );
  const payload = {
    org_login: org,
    email,
    role,
    github_login: (body.github_login || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (match?.id) {
    const { data, error } = await admin
      .from("team_members")
      .update(payload)
      .eq("id", match.id)
      .select("id, org_login, email, role, github_login, seat_assigned, user_id, created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "updated", member: (data || [])[0] ?? null });
  }

  const { data, error } = await admin
    .from("team_members")
    .insert(payload)
    .select("id, org_login, email, role, github_login, seat_assigned, user_id, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "added", member: (data || [])[0] ?? null }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id?: string; email?: string; role?: string; github_login?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("team_members")
    .select("id, org_login")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const orgs = await resolveAllowedOrgs(admin, user.id);
  if (!orgs.includes(String(existing.org_login))) {
    return NextResponse.json({ error: "No access to the requested organization." }, { status: 403 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 422 });
    }
    patch.email = email;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) {
      return NextResponse.json({ error: "role must be admin, manager or member." }, { status: 422 });
    }
    patch.role = body.role;
  }
  if (body.github_login !== undefined) {
    patch.github_login = (body.github_login || "").trim() || null;
  }

  const { data, error } = await admin
    .from("team_members")
    .update(patch)
    .eq("id", id)
    .select("id, org_login, email, role, github_login, seat_assigned, user_id, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "updated", member: (data || [])[0] ?? null });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("team_members")
    .select("id, org_login")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const orgs = await resolveAllowedOrgs(admin, user.id);
  if (!orgs.includes(String(existing.org_login))) {
    return NextResponse.json({ error: "No access to the requested organization." }, { status: 403 });
  }

  const { error } = await admin.from("team_members").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "deleted", id });
}
