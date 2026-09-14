import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const type = searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    // exchangeCodeForSession sets the real Supabase session cookies itself
    // via createClient()'s cookie handlers — nothing else to persist here.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user?.email) {
      if (type === "recovery" || nextParam === "/reset-password") {
        return NextResponse.redirect(`${origin}/reset-password`);
      }
      const target = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
        ? nextParam
        : "/dashboard";
      return NextResponse.redirect(`${origin}${target}`);
    }
  }

  // If code exchange failed or wasn't provided
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
}
