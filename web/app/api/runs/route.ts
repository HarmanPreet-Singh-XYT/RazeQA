import { NextResponse } from "next/server";

const ENGINE_URL = process.env.PLATFORM_URL || "http://localhost:8000";
const ENGINE_API_KEY = process.env.AGENT_API_KEY;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENGINE_API_KEY) headers["Authorization"] = `Bearer ${ENGINE_API_KEY}`;
  return headers;
}

import { execSync } from "child_process";

function getGitInfo(): { sha: string; branch: string } {
  let sha = "HEAD";
  let branch = "main";
  try {
    sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {}
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    if (branch === "HEAD") branch = "main";
  } catch {}
  return { sha, branch };
}

export async function GET(request: Request) {
  const git = getGitInfo();
  if (!ENGINE_API_KEY) {
    return NextResponse.json(
      { runs: [], engineConnected: false, git, error: "Server misconfigured: AGENT_API_KEY is not set." },
      { status: 200 }
    );
  }
  try {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const targetUrl = queryString ? `${ENGINE_URL}/runs?${queryString}` : `${ENGINE_URL}/runs`;

    const res = await fetch(targetUrl, {
      method: "GET",
      headers: engineHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { runs: [], engineConnected: false, git, error: `Engine returned ${res.status}` },
        { status: 200 }
      );
    }

    const runs = await res.json();
    return NextResponse.json({ runs, engineConnected: true, git });
  } catch (err: any) {
    return NextResponse.json(
      { runs: [], engineConnected: false, git, warning: "Engine daemon offline at localhost:8000" },
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
    if (!body.url) {
      const git = getGitInfo();
      if (!body.sha || body.sha.startsWith("f1e2d3c") || body.sha === "HEAD") {
        body.sha = git.sha;
      }
      if (!body.branch || body.branch === "feat/quick-checkout") {
        body.branch = git.branch;
      }
    }
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
