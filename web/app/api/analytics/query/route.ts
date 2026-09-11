import { NextRequest, NextResponse } from "next/server";
import { validatePromptSafety } from "@/lib/security";

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";
const AGENT_API_KEY = process.env.AGENT_API_KEY;

export async function POST(req: NextRequest) {
  if (!AGENT_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = (body.query || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Query parameter is required" }, { status: 400 });
    }

    // Security check
    const validation = validatePromptSafety(query);
    if (!validation.safe) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    try {
      const res = await fetch(`${AGENT_URL}/analytics/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AGENT_API_KEY}`,
        },
        body: JSON.stringify({ query }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }

      return NextResponse.json(
        { error: "AI analytics engine returned an error." },
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
      );
    } catch {
      return NextResponse.json(
        { error: "Could not reach AI analytics engine. Please ensure the agent service is running." },
        { status: 503 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Failed to process AI query" }, { status: 500 });
  }
}
