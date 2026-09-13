import { NextResponse } from "next/server";

/**
 * Starts the GitHub App installation flow.
 *
 * The landing-page CTAs ("Install GitHub App", "Connect GitHub") used to point
 * at `/login`, which is Supabase **GitHub OAuth sign-in** — a different thing
 * entirely: OAuth authenticates the user, it does not grant the engine
 * repository access. This route sends the user to the App's installation page,
 * which is what actually creates the installation the webhook/Check-Run
 * pipeline depends on.
 *
 * Configuration: set GITHUB_APP_SLUG (the App's URL slug, e.g. `autoqa-engine`)
 * in the web environment. When it is not configured we fall back to `/login`
 * rather than redirecting to a URL that would 404.
 */
export function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || process.env.GITHUB_APP_SLUG;

  if (!slug) {
    return NextResponse.redirect(new URL("/login?github_app=unconfigured", origin));
  }

  const installUrl = new URL(
    `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`
  );

  // Preserve a caller-supplied `state` (used to return the user to a specific
  // page) and default it to the import screen.
  const state = searchParams.get("state") || "/dashboard/new";
  installUrl.searchParams.set("state", state);

  return NextResponse.redirect(installUrl);
}
