import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = process.uptime();
  const mem = process.memoryUsage();

  // Test backend engine connectivity
  let engineStatus = "offline";
  const agentUrl = process.env.AGENT_URL || "http://127.0.0.1:8000";
  const agentKey = process.env.AGENT_API_KEY;

  if (!agentKey) {
    engineStatus = "unconfigured";
  } else {
    try {
      const res = await fetch(`${agentUrl}/health`, {
        headers: { Authorization: `Bearer ${agentKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        engineStatus = "connected";
      }
    } catch {
      engineStatus = "unreachable";
    }
  }

  const payload = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(startedAt),
    memory_mb: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
    backend_engine: {
      url: agentUrl,
      status: engineStatus,
    },
    environment: process.env.NODE_ENV || "development",
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
