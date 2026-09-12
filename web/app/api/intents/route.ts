import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const branch = searchParams.get("branch") || "main";

  if (ENGINE_API_KEY) {
    try {
      const targetUrl = `${ENGINE_URL}/bridge/intents/${encodeURIComponent(branch)}`;

      const res = await fetch(targetUrl, {
        method: "GET",
        headers: engineHeaders(),
        cache: "no-store",
      });

      if (res.ok) {
        const rawIntents = await res.json();
        if (Array.isArray(rawIntents) && rawIntents.length > 0) {
          return NextResponse.json({ intents: rawIntents });
        }
      }
    } catch {}
  }

  // Fallback to Supabase intent_logs table
  try {
    const supabase = createAdminClient();
    const { data: dbLogs, error } = await supabase
      .from("intent_logs")
      .select("*")
      .eq("branch", branch)
      .order("created_at", { ascending: false });

    if (!error && dbLogs && dbLogs.length > 0) {
      return NextResponse.json({ intents: dbLogs });
    }
  } catch {}

  return NextResponse.json({ intents: [] }, { status: 200 });
}
