import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";
const AGENT_API_KEY = process.env.AGENT_API_KEY;

export async function GET() {
  if (!AGENT_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${AGENT_URL}/analytics/overview`, {
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

    return NextResponse.json(
      { error: `Analytics engine returned HTTP ${res.status}` },
      { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reach analytics engine. Please ensure the agent service is running." },
      { status: 503 }
    );
  }
}
