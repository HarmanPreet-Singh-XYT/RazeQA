import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";
const AGENT_API_KEY = process.env.AGENT_API_KEY;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing or invalid run ID" }, { status: 400 });
  }

  if (!AGENT_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }

  // 1. Authenticate user & verify run authorization (Mitigate IDOR)
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify tenant access to this run via Supabase RLS policies
    const { data: run, error: runError } = await supabase
      .from("runs")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    // If Supabase has data and RLS denies or run doesn't exist, block cross-tenant access
    if (runError) {
      // If table query errored due to non-existence or permissions
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // If query ran and returned null, check if any runs exist in DB (to allow local runs if DB empty)
    if (!run) {
      const { count } = await supabase.from("runs").select("id", { count: "exact", head: true });
      if (count && count > 0) {
        // Runs exist in DB but this run doesn't belong to the user's projects
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
    }
  } catch {
    // If Supabase client fails to initialize, fail safe or proceed if in local-only mode
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
    }
  }

  // 2. Query backend analytics or synthesize full 30-dimension forensics
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AGENT_API_KEY) {
    headers["Authorization"] = `Bearer ${AGENT_API_KEY}`;
  }

  try {
    const res = await fetch(`${AGENT_URL}/analytics/runs/${encodeURIComponent(id)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.quality_report) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // Engine daemon offline or timed out; fall through to database or synthesized forensics
  }

  // Fallback: Fetch run from Supabase or generate deterministic 30-dimension quality report
  let runRecord: any = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("runs").select("*").eq("id", id).maybeSingle();
    runRecord = data;
  } catch {}

  // If the run record already contains the computed quality dimensions, return them directly
  if (runRecord?.result?.quality_dimensions && typeof runRecord.result.quality_dimensions === "object") {
    return NextResponse.json({
      run_id: runRecord.id,
      branch: runRecord.branch,
      sha: runRecord.sha,
      scope: runRecord.scope,
      status: runRecord.status,
      quality_report: runRecord.result.quality_dimensions,
    });
  }
  if (runRecord?.quality_dimensions && typeof runRecord.quality_dimensions === "object") {
    return NextResponse.json({
      run_id: runRecord.id,
      branch: runRecord.branch,
      sha: runRecord.sha,
      scope: runRecord.scope,
      status: runRecord.status,
      quality_report: runRecord.quality_dimensions,
    });
  }

  // No real analytics available.
  //
  // There used to be ~350 lines here that SYNTHESIZED a full 30-dimension
  // quality report — invented Web Vitals (derived from the run's wall-clock
  // duration), fabricated cost/token counts, made-up accessibility/SEO/security
  // scores, a fake viewport and locale matrix, and a fake flakiness rating.
  // It activated whenever the engine was offline or a run predated analytics,
  // so the dashboard confidently displayed numbers that described nothing.
  //
  // Inventing plausible-looking metrics is worse than showing nothing: it is
  // indistinguishable from real measurement and it silently undermines every
  // real number shown next to it. Return an explicit unavailable signal instead
  // and let the UI say "not measured".
  return NextResponse.json(
    {
      run_id: id,
      branch: runRecord?.branch || null,
      sha: runRecord?.sha || null,
      scope: runRecord?.scope || "changed",
      status: runRecord?.status || "unknown",
      quality_report: null,
      analytics_unavailable: true,
      reason: "no_quality_report_for_run",
      detail:
        "This run has no stored quality report. Analytics are produced by the testing " +
        "engine at run time; nothing is synthesized, because fabricated metrics cannot " +
        "be distinguished from measured ones.",
    },
    { status: 200 }
  );
}
