import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSession } from "@/lib/auth";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user?.email) {
      await createSession(data.user.email);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If code exchange failed or wasn't provided
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
}
