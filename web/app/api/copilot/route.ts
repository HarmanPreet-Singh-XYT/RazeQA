import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canAccessRepo, resolveTenantScope, type TenantScope } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Server-side proxy for the AutoQA AI Copilot.
 *
 * The browser never talks to the engine directly. This route:
 *   1. authenticates the signed-in user,
 *   2. resolves their tenant scope and refuses any repo outside it,
 *   3. assembles a *grounded* context block (the project row + its recent runs),
 *   4. forwards the question to the engine's copilot endpoint.
 *
 * The copilot is only ever as trustworthy as this context, so the data is read
 * here — where ownership is known — rather than being accepted from the client.
 */

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

/** Conversation turns forwarded to the model; keeps prompts bounded. */
const MAX_HISTORY = 16;
const MAX_RUNS = 12;

interface IncomingTurn {
  role?: string;
  content?: string;
}

interface CopilotRequestBody {
  message?: string;
  history?: IncomingTurn[];
  repo_full_name?: string;
  branch?: string;
  sha?: string;
  allow_trigger?: boolean;
  /** Target URL for an `external:` project, which lives in browser storage. */
  target_url?: string;
}

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

interface ProjectRow {
  repo_full_name: string;
  default_branch?: string | null;
  settings?: Record<string, any> | null;
}

/** Pick the project row the caller is asking about, if it is in scope. */
async function loadProjectContext(
  admin: ReturnType<typeof createAdminClient>,
  scope: TenantScope,
  repoFullName: string,
  externalUrl?: string
): Promise<{ project: ProjectRow | null; error?: string }> {
  if (!repoFullName) return { project: null };

  // External sites are not `projects` rows; their identity is `external:<host>`
  // and their URL is supplied by the caller (it lives in browser storage).
  // They are public pages with no stored credentials, so no extra scoping
  // applies — the target is validated again when the run is dispatched.
  if (repoFullName.startsWith("external:")) {
    const host = repoFullName.replace("external:", "");
    const url = externalUrl && /^https?:\/\//i.test(externalUrl) ? externalUrl : `https://${host}`;
    return {
      project: {
        repo_full_name: repoFullName,
        default_branch: "main",
        settings: { domain: url },
      },
    };
  }

  if (!canAccessRepo(scope, repoFullName)) {
    return { project: null, error: "You do not have access to that repository." };
  }

  const { data, error } = await admin
    .from("projects")
    .select("repo_full_name, default_branch, settings")
    .eq("repo_full_name", repoFullName)
    .maybeSingle();

  if (error) return { project: null, error: error.message };
  return { project: (data as ProjectRow) ?? null };
}

/** Recent runs for the project, from the engine with a DB fallback. */
async function loadRecentRuns(repoFullName: string): Promise<any[]> {
  if (!ENGINE_API_KEY || !repoFullName || repoFullName.startsWith("external:")) {
    return dbFallbackRuns(repoFullName);
  }
  try {
    const res = await fetch(
      `${ENGINE_URL}/runs?repo=${encodeURIComponent(repoFullName)}&limit=${MAX_RUNS}`,
      { headers: engineHeaders(), cache: "no-store" }
    );
    if (res.ok) {
      const payload = await res.json();
      const runs = Array.isArray(payload) ? payload : payload.runs || [];
      if (runs.length > 0) return runs.slice(0, MAX_RUNS);
    }
  } catch {
    // Engine offline — fall back to the persisted rows below.
  }
  return dbFallbackRuns(repoFullName);
}

async function dbFallbackRuns(repoFullName: string): Promise<any[]> {
  try {
    const admin = createAdminClient();
    const { data: project } = await admin
      .from("projects")
      .select("id")
      .eq("repo_full_name", repoFullName)
      .maybeSingle();
    if (!project?.id) return [];

    const { data } = await admin
      .from("runs")
      .select("id, branch, sha, scope, test_type, status, result, created_at, completed_at")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(MAX_RUNS);

    return (data || []).map((r: any) => ({
      run_id: r.id,
      branch: r.branch,
      sha: r.sha,
      scope: r.scope,
      test_type: r.test_type,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
      result: r.result,
    }));
  } catch {
    return [];
  }
}

function summarizeRun(run: any): string {
  const result = run?.result || {};
  const summary =
    result.summary ||
    result.message ||
    (Array.isArray(result.failures) && result.failures.length > 0
      ? `${result.failures.length} failure(s): ${result.failures
          .slice(0, 3)
          .map((f: any) => (typeof f === "string" ? f : f?.name || f?.message))
          .filter(Boolean)
          .join("; ")}`
      : "");
  return typeof summary === "string" ? summary : "";
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized: sign in to use the copilot." }, { status: 401 });
  }

  // Every turn is an LLM call on the engine. Cap it per user so one client
  // cannot run up cost or saturate the engine by looping.
  const limit = checkRateLimit("copilot", user.id, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded: at most 20 copilot turns per minute." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.resetMs / 1000)) } }
    );
  }

  let body: CopilotRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set for the web app." },
      { status: 503 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  let scope: TenantScope;
  try {
    admin = createAdminClient();
    scope = await resolveTenantScope(admin, user.id);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Cannot resolve project access: ${err?.message ?? "unknown error"}` },
      { status: 503 }
    );
  }

  const repoFullName = (body.repo_full_name || "").trim();
  const isExternal = repoFullName.startsWith("external:");
  const { project, error: projectError } = await loadProjectContext(
    admin,
    scope,
    repoFullName,
    body.target_url
  );
  if (projectError) {
    return NextResponse.json({ error: projectError }, { status: 403 });
  }

  // Only repos inside the caller's scope may be dispatched against. External
  // sites are exempt: they are public URLs identified by `external:<host>` and
  // carry no stored credentials. Unknown repos fall through to a context-free
  // answer rather than an error, so the copilot works before any import.
  const canTrigger = Boolean(
    project &&
      repoFullName &&
      (isExternal || canAccessRepo(scope, repoFullName))
  );

  // External sites have no `projects` row to join runs against.
  const runs = repoFullName && !isExternal ? await loadRecentRuns(repoFullName) : [];

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role as "user" | "assistant", content: String(t.content).slice(0, 4000) }));

  const payload = {
    message: message.slice(0, 4000),
    history,
    allow_trigger: Boolean(body.allow_trigger !== false && canTrigger),
    branch: body.branch || project?.default_branch || "main",
    sha: body.sha,
    project: project
      ? {
          repo_full_name: project.repo_full_name,
          name: project.settings?.name || project.repo_full_name.split("/")[1] || project.repo_full_name,
          type: isExternal ? "external" : "git",
          default_branch: project.default_branch || "main",
          framework: project.settings?.framework || "",
          target_url: isExternal
            ? String(project.settings?.domain || "")
            : String(project.settings?.domain || ""),
          settings: project.settings || {},
        }
      : null,
    runs: runs.slice(0, MAX_RUNS).map((r: any) => ({
      run_id: String(r.run_id || r.id || ""),
      branch: r.branch || "",
      sha: r.sha || "",
      status: r.status || "",
      scope: r.scope || "",
      test_type: r.test_type || "",
      created_at: r.created_at || "",
      completed_at: r.completed_at || "",
      summary: summarizeRun(r),
    })),
  };

  try {
    const res = await fetch(`${ENGINE_URL}/api/copilot/chat`, {
      method: "POST",
      headers: engineHeaders(),
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || `Copilot request failed (HTTP ${res.status}).` },
        { status: res.status }
      );
    }

    return NextResponse.json({
      reply: data.reply,
      model: data.model,
      provider: data.provider,
      triggered_run: data.triggered_run ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Could not reach the AutoQA engine." },
      { status: 503 }
    );
  }
}
