import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Validates the real Supabase session on every request to a protected route.
 * Uses getUser() (re-verifies the token against the Supabase Auth server),
 * not getSession() (which trusts the cookie payload without verification) —
 * a previous version of this file only checked whether a custom "session"
 * cookie was *present*, which meant `document.cookie = "session=anyone@x.com"`
 * from a browser console fully authenticated as anyone. There is no bypass
 * path here: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) must be configured.
 *
 * API routes under /api/* proxy to the backend testing engine (trigger runs,
 * apply autonomous fixes, read forensic artifacts) or the Supabase-backed
 * projects table. The matcher below previously covered only page routes
 * (/dashboard, /login), which meant every /api/* route was reachable by any
 * anonymous caller who knew the URL — bypassing dashboard auth entirely and
 * exposing cross-tenant run data (the backend engine has no per-user scoping
 * of its own; it trusts the dashboard to gate access). API routes get a JSON
 * 401 instead of an HTML redirect, since they're fetched by client code, not
 * navigated to directly.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Fail closed: refuse to serve protected routes rather than silently
    // treating everyone as unauthenticated (or worse, authenticated).
    if (pathname.startsWith("/dashboard") || isApiRoute) {
      return new NextResponse("Server misconfigured: Supabase is not configured.", {
        status: 503,
      });
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // The public Dev Tools Hub (/tools) includes utilities that cannot run in the
  // browser — OpenGraph/sitemap/schema extraction, TLS certificate probing and
  // CORS preflight testing — because of cross-origin restrictions. Those two
  // endpoints are therefore intentionally reachable without a session: each one
  // is SSRF-guarded (validateExternalTarget resolves DNS and rejects
  // private/loopback/link-local/metadata targets and non-http(s) ports) and
  // rate-limited per client. Nothing tenant-scoped is exposed here.
  const isPublicApiRoute =
    pathname.startsWith("/api/charge") ||
    pathname.startsWith("/api/checkout") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/tools/scrape") ||
    pathname.startsWith("/api/tools/probe");

  if (isApiRoute && !isPublicApiRoute && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/api/:path*"],
};
