import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    // exchangeCodeForSession sets the real Supabase session cookies itself
    // via createClient()'s cookie handlers — nothing else to persist here.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user?.email) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If code exchange failed or wasn't provided
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
}
