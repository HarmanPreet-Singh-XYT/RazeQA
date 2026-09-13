import { createClient } from "@/lib/supabase/server";

export interface TestUser {
  email: string;
  password: string;
}

/**
 * Seeded test account (idea.md Section 3.3): a real Supabase user, provisioned
 * ahead of time (see README/seed script), that the Docker sandbox's automated
 * Playwright login journey authenticates as. This is NOT a bypass — the
 * credentials still go through supabase.auth.signInWithPassword like any
 * other login; "seeded" only means the account is pre-created for automation.
 *
 * Returns `null` when `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` are not
 * configured. The previous `qa@example.com` / `changeme123` fallbacks were
 * shipped in `.env.example`, which meant any deployment that had provisioned
 * that account exposed a working login for a publicly documented password.
 */
export function getTestUser(): TestUser | null {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

/**
 * Whether the one-click "Quick Sandbox Sign In" convenience button is enabled.
 * Off unless explicitly turned on, so a public deployment cannot hand out a
 * session on the shared automation account without an explicit decision.
 */
export function isSandboxLoginEnabled(): boolean {
  return process.env.ENABLE_SANDBOX_LOGIN === "true";
}

/**
 * Server-side session check. Uses getUser() (not getSession()) because
 * getUser() re-validates the token against the Supabase Auth server on every
 * call — getSession() only reads the (client-supplied, spoofable) cookie
 * payload without verifying it against the server.
 */
export async function getSessionUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

export async function getSession(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.email ?? null;
}
