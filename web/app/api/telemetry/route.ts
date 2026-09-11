import { NextRequest, NextResponse } from "next/server";

const MAX_PAYLOAD_SIZE = 16 * 1024; // 16 KB

export async function POST(req: NextRequest) {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const event = JSON.parse(rawBody);
    if (!event || typeof event !== "object") {
      return NextResponse.json({ error: "Invalid payload format" }, { status: 400 });
    }

    // Validate and sanitize telemetry fields
    const sanitize = (val: any) =>
      typeof val === "string" ? val.slice(0, 256).replace(/[\r\n]/g, "") : "";

    const eventType = sanitize(event.type);
    const eventName = sanitize(event.name);
    const eventUrl = sanitize(event.url);

    if (!eventType || !eventName) {
      return NextResponse.json({ error: "Missing required telemetry fields" }, { status: 400 });
    }

    // In production, forward to Datadog / OpenTelemetry / Supabase telemetry table
    // In local development, log sanitized event
    if (process.env.NODE_ENV !== "production") {
      console.log(`[AutoQA Telemetry] ${eventType}: ${eventName} on ${eventUrl}`);
    }

    return NextResponse.json({ status: "received" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "invalid_payload" }, { status: 400 });
  }
}
