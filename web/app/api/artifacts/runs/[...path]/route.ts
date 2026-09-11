import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

/**
 * Streams a forensic artifact (video/trace/screenshot) from the engine to
 * the browser. The engine requires a bearer token on every request — the
 * browser never sees that token; this server-side proxy holds it and
 * forwards it, then streams the response body straight through.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 503 }
    );
  }

  const { path } = await params;
  const subPath = path.map(encodeURIComponent).join("/");

  const res = await fetch(`${ENGINE_URL}/artifacts/runs/${subPath}`, {
    headers: { Authorization: `Bearer ${ENGINE_API_KEY}` },
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "Artifact not found" }, { status: res.status || 404 });
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/octet-stream",
      "Content-Length": res.headers.get("content-length") || "",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
