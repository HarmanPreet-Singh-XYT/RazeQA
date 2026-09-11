import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

export async function GET(request: Request) {
  if (!ENGINE_API_KEY) {
    return NextResponse.json({ intents: [], warning: "AGENT_API_KEY not set" }, { status: 200 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const branch = searchParams.get("branch") || "main";
    const targetUrl = `${ENGINE_URL}/bridge/intents/${encodeURIComponent(branch)}`;

    const res = await fetch(targetUrl, {
      method: "GET",
      headers: engineHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ intents: [] }, { status: 200 });
    }

    const rawIntents = await res.json();
    return NextResponse.json({ intents: Array.isArray(rawIntents) ? rawIntents : [] });
  } catch {
    return NextResponse.json({ intents: [] }, { status: 200 });
  }
}
