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
  /** Agent permission mode: read_only | standard | autonomous. */
  mode?: string;
  /** Action ids the user approved, replayed so the same tool call may proceed. */
  approvals?: unknown;
  /** Cap on tool calls the agent may make for this turn. */
  max_tool_calls?: number;
  /** Reasoning provider override: anthropic | bedrock | gemini. */
  provider?: string;
  /** Default scope/test type used when the agent dispatches a run. */
  scope?: string;
  test_type?: string;
}

const AGENT_MODES = new Set(["read_only", "standard", "autonomous"]);
const PROVIDERS = new Set(["anthropic", "bedrock", "gemini"]);
const SCOPES = new Set(["changed", "full"]);
const TEST_TYPES = new Set(["functional", "exploratory"]);

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

/**
 * Which providers the engine can actually reach, for the composer's model
 * picker. Deliberately available before any project is selected.
 */
export async function GET() {
  try {
    const res = await fetch(`${ENGINE_URL}/api/copilot/health`, {
      headers: engineHeaders(),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { status: "unavailable", providers: [], error: data.detail || `HTTP ${res.status}` },
        { status: 200 }
      );
    }
    return NextResponse.json({
      status: data.status ?? "unknown",
      model: data.model ?? null,
      providers: Array.isArray(data.providers) ? data.providers : [],
      tool_count: data.tool_count ?? 0,
      modes: Array.isArray(data.modes) ? data.modes : [],
    });
  } catch {
    return NextResponse.json({ status: "unreachable", providers: [] }, { status: 200 });
  }
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

  // Session controls are clamped here rather than trusted: the browser picks
  // them, but the engine must never be handed an out-of-range mode or budget.
  const mode = AGENT_MODES.has(String(body.mode)) ? String(body.mode) : "standard";
  const provider = PROVIDERS.has(String(body.provider)) ? String(body.provider) : undefined;
  const runScope = SCOPES.has(String(body.scope)) ? String(body.scope) : "changed";
  const testType = TEST_TYPES.has(String(body.test_type))
    ? String(body.test_type)
    : "functional";
  const maxToolCalls = Math.max(
    1,
    Math.min(20, Number.isFinite(body.max_tool_calls) ? Number(body.max_tool_calls) : 8)
  );
  // Approvals are opaque action ids minted by the engine; they are passed
  // through untouched, bounded so a caller cannot flood the prompt.
  const approvals = (Array.isArray(body.approvals) ? body.approvals : [])
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128)
    .slice(0, 10);

  // A read-only session cannot dispatch, whatever the caller asked for.
  const allowTrigger = Boolean(body.allow_trigger !== false && canTrigger && mode !== "read_only");

  const payload = {
    message: message.slice(0, 4000),
    history,
    allow_trigger: allowTrigger,
    branch: body.branch || project?.default_branch || "main",
    sha: body.sha,
    mode,
    approvals,
    max_tool_calls: maxToolCalls,
    provider,
    scope: runScope,
    test_type: testType,
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
      // The agent's tool calls for this turn, so the transcript can show what
      // the answer was grounded in rather than presenting it as unsourced.
      tool_calls: Array.isArray(data.tool_calls) ? data.tool_calls : [],
      // Write actions the agent stopped short of; the UI turns these into
      // approval cards rather than letting them silently not happen.
      pending_approvals: Array.isArray(data.pending_approvals) ? data.pending_approvals : [],
      steps_used: Number.isFinite(data.steps_used) ? data.steps_used : 0,
      max_tool_calls: Number.isFinite(data.max_tool_calls) ? data.max_tool_calls : maxToolCalls,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Could not reach the AutoQA engine." },
      { status: 503 }
    );
  }
}
