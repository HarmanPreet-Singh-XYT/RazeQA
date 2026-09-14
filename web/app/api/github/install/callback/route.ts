import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeReturnPath } from "@/lib/github/connection";

/**
 * GitHub App Setup URL: where GitHub returns the user after they install or
 * update the App.
 *
 * Configure this as the App's "Setup URL" in the GitHub App settings
 * (`<deployment>/api/github/install/callback`). Without it GitHub drops the user
 * on the App's homepage and the import screen only finds out about the new
 * installation when they reload.
 *
 * What this does:
 *   1. requires a signed-in session, and
 *   2. kicks off a catalogue sync so the new installation's repositories are
 *      available immediately instead of waiting for the webhook,
 *   3. bounces the user back to the import screen with `github_app=connected`,
 *      where the UI polls until the connection resolves.
 *
 * What this deliberately does NOT do: record the installer. Any caller can hit
 * this URL with an arbitrary `installation_id`, so treating it as proof of
 * ownership would let one user claim another account's installation. Ownership
 * is established only by the signature-verified `installation` webhook `sender`
 * (see agent/src/agent/api/webhooks.py).
 */

const DEFAULT_STATE = "/dashboard/new?github_app=connected";

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const state = sanitizeReturnPath(searchParams.get("state"), DEFAULT_STATE);
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The install itself happened against their GitHub account. `/login` does
    // not carry a return path today, so send them there plainly: once they are
    // signed in, the import screen resolves the connection on its own (the
    // webhook will have landed by then).
    return NextResponse.redirect(new URL("/login", origin));
  }

  if (installationId || setupAction === "install" || setupAction === "update") {
    await syncInstallations();
  }

  return NextResponse.redirect(new URL(state, origin));
}

/**
 * Ask the agent to re-catalogue this App's installations. Best effort: the
 * webhook remains the source of truth, and a slow or offline engine must not
 * block the user's return to the dashboard.
 */
async function syncInstallations(): Promise<void> {
  const platformUrl = process.env.PLATFORM_URL || "http://localhost:8000";
  const agentKey = process.env.AGENT_API_KEY;

  try {
    await fetch(`${platformUrl}/api/github/sync`, {
      method: "POST",
      headers: {
        ...(agentKey ? { Authorization: `Bearer ${agentKey}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn("Post-install GitHub App sync failed (webhook will still apply):", err);
  }
}
