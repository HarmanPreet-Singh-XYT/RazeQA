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

  // 2. Query actual backend analytics
  try {
    const res = await fetch(`${AGENT_URL}/analytics/runs/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${AGENT_API_KEY}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (res.status === 404) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: `Backend engine returned HTTP ${res.status}` },
      { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reach analytics engine. Please ensure the agent service is running." },
      { status: 503 }
    );
  }
}
