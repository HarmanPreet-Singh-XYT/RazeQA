import { NextResponse } from "next/server";

export async function POST() {
  const platformUrl = process.env.PLATFORM_URL || "http://localhost:8000";
  const agentKey = process.env.AGENT_API_KEY;

  try {
    const res = await fetch(`${platformUrl}/api/github/sync`, {
      method: "POST",
      headers: {
        ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
      },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    } else {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.detail || "Failed to synchronize GitHub App repositories" },
        { status: res.status }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Agent platform service unreachable" },
      { status: 503 }
    );
  }
}
