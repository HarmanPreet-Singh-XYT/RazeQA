import { createClient } from "@supabase/supabase-js";

/**
 * Elevated (RLS-bypassing) Supabase client for server-side writes.
 *
 * This previously fell back to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY when no secret key was configured. That
 * fallback was worse than useless: the publishable/anon key is still subject
 * to RLS, so every write failed with the opaque Postgres error
 * `new row violates row-level security policy for table "projects"` — which
 * surfaced in the UI as a bogus "deploy" failure instead of a clear
 * misconfiguration. A missing secret key must fail loudly, not silently
 * downgrade to a key that cannot possibly write.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Server misconfigured: NEXT_PUBLIC_SUPABASE_URL is not set. See web/.env.example."
    );
  }

  if (!secretKey) {
    throw new Error(
      "Server misconfigured: SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is not set. " +
        "Project writes require elevated credentials because the projects/runs tables are protected by " +
        "row-level security. See web/.env.example."
    );
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
