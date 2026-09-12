import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const platformUrl = process.env.PLATFORM_URL || "http://localhost:8000";
  const agentKey = process.env.AGENT_API_KEY;

  // 1. Try querying the agent backend for real-time GitHub App data
  try {
    const res = await fetch(`${platformUrl}/api/github/repos`, {
      headers: {
        ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
      },
      next: { revalidate: 30 },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend may be offline; fallback to Supabase installations below
  }

  // 2. Fallback: Query Supabase installations table directly
  try {
    const supabase = await createClient();
    const { data: installations, error } = await supabase
      .from("installations")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && installations && installations.length > 0) {
      const allRepos: any[] = [];
      for (const inst of installations) {
        const repos = Array.isArray(inst.repositories) ? inst.repositories : [];
        for (const r of repos) {
          allRepos.push({
            installation_id: inst.installation_id,
            account: inst.account_login,
            repo_full_name: r.full_name || r.name,
            repo_name: r.name,
            default_branch: r.default_branch || "main",
            private: !!r.private,
            html_url: r.html_url || `https://github.com/${r.full_name || r.name}`,
          });
        }
      }
      return NextResponse.json({ repositories: allRepos, count: allRepos.length, source: "supabase" });
    }
  } catch (err: any) {
    console.error("Failed to query fallback installations from Supabase:", err);
  }

  return NextResponse.json({ repositories: [], count: 0 });
}

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
