import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

export async function GET() {
  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { runs: [], engineConnected: false, error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 200 }
    );
  }
  try {
    const res = await fetch(`${ENGINE_URL}/runs`, {
      method: "GET",
      headers: engineHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { runs: [], engineConnected: false, error: `Engine returned ${res.status}` },
        { status: 200 }
      );
    }

    const runs = await res.json();
    return NextResponse.json({ runs, engineConnected: true });
  } catch (err: any) {
    return NextResponse.json(
      { runs: [], engineConnected: false, warning: "Engine daemon offline at localhost:8000" },
      { status: 200 }
    );
  }
}

export async function POST(request: Request) {
  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { status: "failed", error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const targetEndpoint = body.url ? `${ENGINE_URL}/runs/external` : `${ENGINE_URL}/runs`;
    const res = await fetch(targetEndpoint, {
      method: "POST",
      headers: engineHeaders(),
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        status: "failed",
        error: "Could not reach PR Testing Engine. Please ensure the backend is running.",
      },
      { status: 503 }
    );
  }
}
