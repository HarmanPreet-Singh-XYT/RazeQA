import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { canAccessRepo, resolveTenantScope } from "@/lib/tenant";

/**
 * Cancel a queued or running test run.
 *
 * The engine is the only thing that can actually stop the sandbox and browser
 * sweep, so this is a thin authenticated proxy. Tenant scope is enforced before
 * forwarding: an inaccessible run is answered with 404, exactly like the GET
 * handler, so the endpoint never confirms that someone else's run exists.
 */

export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.PLATFORM_URL || process.env.AGENT_URL || "http://127.0.0.1:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

async function fetchEngineRun(id: string): Promise<Record<string, any> | null> {
  if (!ENGINE_API_KEY) return null;
  try {
    const res = await fetch(`${ENGINE_URL}/runs/${encodeURIComponent(id)}`, {
      headers: engineHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  let scope: Awaited<ReturnType<typeof resolveTenantScope>>;
  try {
    admin = createAdminClient();
    scope = await resolveTenantScope(admin, user.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Cannot resolve access: ${message}` }, { status: 503 });
  }

  const [engineRun, dbRunResult] = await Promise.all([
    fetchEngineRun(id),
    admin.from("runs").select("id, project_id").eq("id", id).maybeSingle(),
  ]);
  const dbRun = dbRunResult.data;

  if (dbRun && !scope.includeUnowned && !scope.projectIds.includes(dbRun.project_id)) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (!dbRun && !scope.includeUnowned) {
    const repo = engineRun?.repo || engineRun?.repo_full_name || null;
    if (!canAccessRepo(scope, repo)) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
  }

  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${ENGINE_URL}/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: engineHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Engine unreachable";
    return NextResponse.json(
      { error: `Could not reach the engine to cancel this run: ${message}` },
      { status: 502 }
    );
  }
}
