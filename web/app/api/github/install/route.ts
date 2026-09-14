import { NextResponse } from "next/server";
import { sanitizeReturnPath } from "@/lib/github/connection";

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
 * `state` is echoed back by GitHub to the App's Setup URL, which should be
 * configured as `/api/github/install/callback`. It is validated here because an
 * unvalidated value turns this route into an open redirect.
 *
 * Configuration: set GITHUB_APP_SLUG (the App's URL slug, e.g. `razeqa-engine`)
 * in the web environment. When it is not configured we fall back to `/login`
 * rather than redirecting to a URL that would 404.
 */

/** Where the user lands after installing, so the import screen re-checks. */
const DEFAULT_STATE = "/dashboard/new?github_app=connected";

export function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || process.env.GITHUB_APP_SLUG;
  const state = sanitizeReturnPath(searchParams.get("state"), DEFAULT_STATE);

  if (!slug) {
    return NextResponse.redirect(new URL("/login?github_app=unconfigured", origin));
  }

  const installUrl = new URL(
    `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`
  );

  // Preserve the (validated) caller-supplied return path, defaulting to the
  // import screen so the install is always followed by a connection re-check.
  installUrl.searchParams.set("state", state);

  return NextResponse.redirect(installUrl);
}
