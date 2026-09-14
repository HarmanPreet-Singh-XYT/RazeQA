import { NextResponse } from "next/server";
import { getGitHubAppInstallUrl, sanitizeReturnPath } from "@/lib/github/connection";

/**
 * Starts the GitHub App installation flow.
 *
 * Directs the user to the App's installation page configured via
 * GITHUB_APP_URL / NEXT_PUBLIC_GITHUB_APP_URL or GITHUB_APP_SLUG / NEXT_PUBLIC_GITHUB_APP_SLUG.
 */

/** Where the user lands after installing, so the import screen re-checks. */
const DEFAULT_STATE = "/dashboard/new?github_app=connected";

export function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const state = sanitizeReturnPath(searchParams.get("state"), DEFAULT_STATE);
  const installUrl = getGitHubAppInstallUrl(state);

  if (!installUrl) {
    return NextResponse.redirect(new URL("/login?github_app=unconfigured", origin));
  }

  return NextResponse.redirect(new URL(installUrl));
}
