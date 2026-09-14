import { redirect } from "next/navigation";

/**
 * The copilot used to live here; it is now the dashboard home. Kept as a
 * redirect so existing links and bookmarks keep working.
 */
export default async function AgentRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const repo = params?.repo;
  const suffix = typeof repo === "string" && repo ? `?repo=${encodeURIComponent(repo)}` : "";
  redirect(`/dashboard${suffix}`);
}
