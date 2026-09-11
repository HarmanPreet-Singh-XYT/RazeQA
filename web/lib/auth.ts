import { createClient } from "@/lib/supabase/server";

/**
 * Seeded test account (idea.md Section 3.3): a real Supabase user, provisioned
 * ahead of time (see README/seed script), that the Docker sandbox's automated
 * Playwright login journey authenticates as. This is NOT a bypass — the
 * credentials still go through supabase.auth.signInWithPassword like any
 * other login; "seeded" only means the account is pre-created for automation.
 */
export function getTestUser() {
  const email = process.env.TEST_USER_EMAIL ?? "qa@example.com";
  const password = process.env.TEST_USER_PASSWORD ?? "changeme123";
  return { email, password };
}

/**
 * Server-side session check. Uses getUser() (not getSession()) because
 * getUser() re-validates the token against the Supabase Auth server on every
 * call — getSession() only reads the (client-supplied, spoofable) cookie
 * payload without verifying it against the server.
 */
export async function getSession(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}
