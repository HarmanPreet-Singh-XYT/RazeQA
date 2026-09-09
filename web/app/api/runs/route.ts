import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${ENGINE_URL}/runs`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
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
  try {
    const body = await request.json();
    const res = await fetch(`${ENGINE_URL}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "failed",
        error: `Could not reach PR Testing Engine at ${ENGINE_URL}: ${err?.message}`,
      },
      { status: 503 }
    );
  }
}
