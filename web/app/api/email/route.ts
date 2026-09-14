import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";

/**
 * Email notification settings and delivery log for one repository.
 *
 * The SMTP transport itself lives in the engine (see agent/src/agent/email/),
 * so this route is a thin, authenticated proxy: it verifies the caller owns the
 * repository, then asks the engine for the live configuration and the recent
 * outbox. When the engine is unreachable it falls back to reading
 * `email_messages` from Supabase so the delivery log still renders.
 *
 * A test send is a real outbound message, so it requires an owned project and is
 * rate-limited by the engine.
 */

export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

interface EmailMessageRow {
  id?: string;
  kind?: string;
  subject?: string;
  recipients?: unknown;
  status?: string;
  attempts?: number;
  last_error?: string | null;
  run_id?: string | null;
  created_at?: string;
  sent_at?: string | null;
}

/** Map a Supabase row to the same shape the engine's /email/messages returns. */
function normalizeMessage(row: EmailMessageRow) {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error ?? null,
    runId: row.run_id ?? null,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? null,
  };
}

async function resolveOwnedProject(
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

  const admin = createAdminClient();
  let project = null;
  if (repo) {
    project = await resolveOwnedProject(admin, user.id, repo);
    if (!project) {
      return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
    }
  }

  // The delivery log is readable directly, so it is fetched regardless of
  // whether the engine answers.
  let messages: ReturnType<typeof normalizeMessage>[] = [];
  if (project) {
    const { data, error } = await admin
      .from("email_messages")
      .select("id, kind, subject, recipients, status, attempts, last_error, run_id, created_at, sent_at")
      .eq("repo_full_name", repo)
      .order("created_at", { ascending: false })
      .limit(25);
    if (!error) {
      messages = (data || []).map((row) => normalizeMessage(row as EmailMessageRow));
    } else if (!/relation .* does not exist|could not find the table|schema cache/i.test(error.message || "")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json({
      configured: false,
      enabled: false,
      active: false,
      messages,
      error: "Server misconfigured: AGENT_API_KEY is not set.",
    });
  }

  try {
    const target = repo
      ? `${ENGINE_URL}/email/status?repo=${encodeURIComponent(repo)}`
      : `${ENGINE_URL}/email/status`;
    const res = await fetch(target, { headers: engineHeaders(), cache: "no-store" });
    if (res.ok) {
      const status = await res.json();
      return NextResponse.json({ ...status, messages });
    }
    return NextResponse.json({
      configured: false,
      enabled: false,
      active: false,
      messages,
      warning: `Engine returned HTTP ${res.status}.`,
    });
  } catch {
    return NextResponse.json({
      configured: false,
      enabled: false,
      active: false,
      messages,
      warning: "Engine daemon offline; showing the stored delivery log only.",
    });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { repo?: string; to?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const repo = (body.repo || "").trim();
  if (!repo) return NextResponse.json({ error: "repo is required." }, { status: 400 });

  const admin = createAdminClient();
  const project = await resolveOwnedProject(admin, user.id, repo);
  if (!project) {
    return NextResponse.json({ error: "Project not found for this account." }, { status: 404 });
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${ENGINE_URL}/email/test`, {
      method: "POST",
      headers: engineHeaders(),
      body: JSON.stringify({ to: (body.to || "").trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the PR Testing Engine. Please ensure the backend is running." },
      { status: 503 }
    );
  }
}
