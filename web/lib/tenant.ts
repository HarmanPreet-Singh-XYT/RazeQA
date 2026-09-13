import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user tenant scoping for the API routes.
 *
 * The engine has no notion of users: it stores runs keyed by branch/SHA/repo and
 * trusts the dashboard to gate access. That made every authenticated dashboard
 * user able to read every run in the deployment. These helpers resolve the
 * repositories a caller is actually allowed to see by looking at the projects
 * they own, so each route can scope instead of returning everything.
 *
 * `SHOW_UNOWNED_PROJECTS=true` restores the old "any signed-in user can see
 * agent-created, ownerless rows" behaviour for single-tenant/self-hosted
 * deployments. It is off by default because it is exactly the cross-tenant
 * exposure this module exists to close.
 */

export interface TenantScope {
  userId: string;
  projectIds: string[];
  repoNames: string[];
  includeUnowned: boolean;
}

export function showUnownedProjects(): boolean {
  return process.env.SHOW_UNOWNED_PROJECTS === "true";
}

export async function resolveTenantScope(
  admin: SupabaseClient,
  userId: string
): Promise<TenantScope> {
  const includeUnowned = showUnownedProjects();

  const base = admin.from("projects").select("id, repo_full_name, user_id");
  const query = includeUnowned
    ? base.or(`user_id.eq.${userId},user_id.is.null`)
    : base.eq("user_id", userId);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const projectIds = (data || [])
    .map((p: { id?: string }) => p.id)
    .filter((id): id is string => Boolean(id));
  const repoNames = (data || [])
    .map((p: { repo_full_name?: string }) => p.repo_full_name)
    .filter((name): name is string => Boolean(name));

  return { userId, projectIds, repoNames, includeUnowned };
}

/** True when a repo name is inside the caller's scope. */
export function canAccessRepo(scope: TenantScope, repo: unknown): boolean {
  // Legacy mode: the deployment opted back into the old permissive behaviour.
  if (scope.includeUnowned) return true;
  return typeof repo === "string" && scope.repoNames.includes(repo);
}
