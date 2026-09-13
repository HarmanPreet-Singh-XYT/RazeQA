/**
 * Server-side discovery of repositories granted to the GitHub App.
 *
 * Both the import picker (`/api/github/repos`) and live-URL resolution
 * (`/api/github/repo-url`) need the same view of what the App can access, so the
 * lookup lives here rather than being duplicated.
 *
 * Discovery is read-only. It never creates `projects` rows.
 */

export interface DiscoveredRepo {
  installation_id: number | null;
  account: string | null;
  repo_full_name: string;
  repo_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
  /** Where the deployed site lives, per GitHub's repo homepage field. */
  homepage: string;
  description: string;
}

type SupabaseServerClient = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createClient>
>;

function normalizeFromAgent(item: any): DiscoveredRepo {
  return {
    installation_id: item.installation_id ?? null,
    account: item.account ?? null,
    repo_full_name: item.repo_full_name,
    repo_name: item.repo_name || item.repo_full_name?.split("/")[1] || item.repo_full_name,
    default_branch: item.default_branch || "main",
    private: !!item.private,
    html_url: item.html_url || `https://github.com/${item.repo_full_name}`,
    homepage: item.homepage || "",
    description: item.description || "",
  };
}

export async function discoverRepositories(
  supabase: SupabaseServerClient
): Promise<DiscoveredRepo[]> {
  const platformUrl = process.env.PLATFORM_URL || "http://localhost:8000";
  const agentKey = process.env.AGENT_API_KEY;

  // 1. Prefer real-time GitHub App data from the agent backend.
  try {
    const res = await fetch(`${platformUrl}/api/github/repos`, {
      headers: {
        ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
      },
      next: { revalidate: 60 },
    });

    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data?.repositories) ? data.repositories : [];
      if (list.length > 0) {
        return list.map(normalizeFromAgent);
      }
    }
  } catch {
    // Backend may be offline; fall back to the persisted catalogue below.
  }

  // 2. Fallback: the persisted installations catalogue.
  try {
    const { data: installations, error } = await supabase
      .from("installations")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && installations && installations.length > 0) {
      const allRepos: DiscoveredRepo[] = [];
      for (const inst of installations) {
        const repos = Array.isArray(inst.repositories) ? inst.repositories : [];
        for (const r of repos) {
          const fullName = r.full_name || r.name;
          allRepos.push({
            installation_id: inst.installation_id ?? null,
            account: inst.account_login ?? null,
            repo_full_name: fullName,
            repo_name: r.name || fullName?.split("/")[1] || fullName,
            default_branch: r.default_branch || "main",
            private: !!r.private,
            html_url: r.html_url || `https://github.com/${fullName}`,
            homepage: r.homepage || "",
            description: r.description || "",
          });
        }
      }
      return allRepos;
    }
  } catch (err) {
    console.error("Failed to query fallback installations from Supabase:", err);
  }

  return [];
}
