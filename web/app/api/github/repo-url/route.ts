import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverRepositories } from "@/lib/github/discovery";
import { resolveGitHubConnection, type GitHubConnection } from "@/lib/github/connection";

/**
 * Resolve the live URL for an imported repository.
 *
 * The dashboard previously assumed `http://localhost:<port>` for every project,
 * which is meaningless for a repo that deploys to Vercel/Netlify. The real URL
 * usually already exists on GitHub: the App's repository listing carries a
 * `homepage`, and GitHub tracks deployments (including the ones Vercel/Netlify
 * create from `main`) with a status environment URL.
 *
 * Read-only: this never mutates the database. Best effort — it returns
 * `url: null` rather than guessing when GitHub has nothing to offer.
 */

interface RepoUrlResult {
  repo_full_name: string;
  url: string | null;
  source: "deployment" | "repository_homepage" | null;
  environment: string | null;
  error?: string;
}

const REPO_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * A URL only counts as a live site if it is an absolute public http(s) address.
 * Loopback entries are treated as "not published" so the UI never presents a
 * developer address as a deployment.
 */
function sanitizePublicUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;

  try {
    const host = new URL(value).hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Look for a live URL on GitHub. Only called when the App listing had no usable
 * `homepage`, since each call costs up to three GitHub requests.
 */
async function fetchDeploymentUrl(
  repoFullName: string
): Promise<{ url: string | null; environment: string | null }> {
  const headers = githubHeaders();

  const deploymentsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/deployments?per_page=5`,
    { headers, next: { revalidate: 300 } }
  ).catch(() => null);

  if (!deploymentsRes?.ok) return { url: null, environment: null };

  const deployments = await deploymentsRes.json().catch(() => []);
  if (!Array.isArray(deployments)) return { url: null, environment: null };

  // Newest first (GitHub returns them in reverse-chronological order); take the
  // first deployment that actually has a reachable environment URL.
  for (const deployment of deployments.slice(0, 5)) {
    const statusesRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/deployments/${deployment.id}/statuses?per_page=5`,
      { headers, next: { revalidate: 300 } }
    ).catch(() => null);

    if (!statusesRes?.ok) continue;
    const statuses = await statusesRes.json().catch(() => []);
    if (!Array.isArray(statuses)) continue;

    for (const status of statuses) {
      // Only a successful deployment is live; a failed one still carries a URL
      // that would 404 for the user.
      if (status?.state && status.state !== "success") continue;
      const url = sanitizePublicUrl(status?.environment_url);
      if (url) {
        return { url, environment: deployment?.environment ?? null };
      }
    }
  }

  return { url: null, environment: null };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requested: Array<{ repo_full_name: string }> = Array.isArray(body?.repos)
    ? body.repos
    : [];

  if (requested.length === 0) {
    return NextResponse.json({ results: [] });
  }
  if (requested.length > 25) {
    return NextResponse.json(
      { error: "Too many repositories requested (max 25 per call)." },
      { status: 400 }
    );
  }

  // Only resolve repos this deployment can actually reach, and take the
  // homepage from discovery rather than trusting the request body.
  //
  // Discovery must be scoped to the caller's own installations: the agent's
  // catalogue is a union across every tenant, and the unscoped version let any
  // signed-in user read the homepage / deployment URL of any repository.
  let admin: ReturnType<typeof createAdminClient>;
  let connection: GitHubConnection;
  try {
    admin = createAdminClient();
    connection = await resolveGitHubConnection(admin, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase admin client unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  if (!connection.connected) {
    return NextResponse.json({ results: [] });
  }

  const discovered = await discoverRepositories(admin, {
    installationIds: connection.installationIds,
  });
  const byName = new Map(discovered.map((r) => [r.repo_full_name.toLowerCase(), r]));

  const results: RepoUrlResult[] = await Promise.all(
    requested.map(async (item) => {
      const name = String(item?.repo_full_name || "");
      if (!REPO_FULL_NAME_PATTERN.test(name)) {
        return {
          repo_full_name: name,
          url: null,
          source: null,
          environment: null,
          error: "Invalid repository name.",
        };
      }

      const known = byName.get(name.toLowerCase());

      // 1. The repository's own homepage. For a deployed app this is the URL the
      //    owner intends as canonical, so it wins over a preview deployment.
      const homepage = sanitizePublicUrl(known?.homepage);
      if (homepage) {
        return {
          repo_full_name: name,
          url: homepage,
          source: "repository_homepage" as const,
          environment: null,
        };
      }

      // 2. Fall back to GitHub's deployment records.
      try {
        const deployment = await fetchDeploymentUrl(name);
        return {
          repo_full_name: name,
          url: deployment.url,
          source: deployment.url ? ("deployment" as const) : null,
          environment: deployment.environment,
        };
      } catch (err: any) {
        return {
          repo_full_name: name,
          url: null,
          source: null,
          environment: null,
          error: err?.message || "Lookup failed",
        };
      }
    })
  );

  return NextResponse.json({ results });
}
