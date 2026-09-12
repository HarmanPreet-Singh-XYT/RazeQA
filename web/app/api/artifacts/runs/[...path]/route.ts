import { NextRequest, NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

/**
 * Streams a forensic artifact (video/trace/screenshot) from the engine to
 * the browser. The engine requires a bearer token on every request — the
 * browser never sees that token; this server-side proxy holds it and
 * forwards it, then streams the response body straight through.
 *
 * RANGE REQUEST PASSTHROUGH
 * --------------------------
 * Browsers require HTTP Range requests (RFC 7233) to play <video> inline —
 * they send "Range: bytes=0-" and expect "206 Partial Content" back.
 * This proxy forwards the Range header to the engine and passes the 206
 * status + Content-Range / Accept-Ranges headers back to the browser so
 * video playback works correctly (not just download).
 */
export async function GET(
  request: NextRequest,
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

  const upstreamHeaders: HeadersInit = {
    Authorization: `Bearer ${ENGINE_API_KEY}`,
  };

  // Forward the Range header so the engine can return a 206 Partial Content
  // response — required for browser video playback (seeking, buffering).
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    upstreamHeaders["Range"] = rangeHeader;
  }

  const res = await fetch(`${ENGINE_URL}/artifacts/runs/${subPath}`, {
    headers: upstreamHeaders,
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    return NextResponse.json(
      { error: "Artifact not found" },
      { status: res.status || 404 }
    );
  }

  // Build response headers — pass through Range-related headers from the engine
  // so the browser knows it can seek and buffer the video.
  const responseHeaders: Record<string, string> = {
    "Content-Type": res.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    // Always advertise range support so the browser knows it can seek
    "Accept-Ranges": res.headers.get("accept-ranges") || "bytes",
  };

  const contentLength = res.headers.get("content-length");
  if (contentLength) responseHeaders["Content-Length"] = contentLength;

  const contentRange = res.headers.get("content-range");
  if (contentRange) responseHeaders["Content-Range"] = contentRange;

  return new NextResponse(res.body, {
    // Preserve 206 Partial Content from the engine — do NOT hardcode 200
    status: res.status,
    headers: responseHeaders,
  });
}
