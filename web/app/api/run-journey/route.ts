import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getTestUser } from "@/lib/auth";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

export async function POST(request: Request) {
  // This route performs several server-side fetches and optionally a seeded
  // sign-in; cap it so it cannot be used to hammer the app under test.
  const limit = checkRateLimit("run-journey", getClientIdentifier(request), 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before running another journey." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.resetMs / 1000)) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const simulateFailure = Boolean(body.simulateFailure);
  const startTime = Date.now();

  const steps: Array<{
    name: string;
    target: string;
    status: "passed" | "failed";
    durationMs: number;
    details: string;
  }> = [];

  // Use a server-configured origin rather than trusting the client-supplied
  // Host header, which an attacker can set to an arbitrary value and cause
  // this handler's own server-side fetch() calls to target it (SSRF).
  const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";

  try {
    // Step 1: Healthcheck landing page
    const t0 = Date.now();
    const landingRes = await fetch(`${baseUrl}/`, { method: "GET" });
    steps.push({
      name: "Landing Surface Check",
      target: "GET /",
      status: landingRes.ok ? "passed" : "failed",
      durationMs: Date.now() - t0,
      details: `HTTP ${landingRes.status} ${landingRes.statusText}`,
    });

    // Step 2: Gated route unauthorized redirect check
    const t1 = Date.now();
    const gatedRes = await fetch(`${baseUrl}/dashboard`, {
      method: "GET",
      redirect: "manual",
    });
    const isRedirect =
      gatedRes.status === 307 ||
      gatedRes.status === 302 ||
      gatedRes.status === 303 ||
      gatedRes.headers.get("location")?.includes("/login");
    steps.push({
      name: "Route Guard Verification",
      target: "GET /dashboard (unauthenticated)",
      status: isRedirect ? "passed" : "failed",
      durationMs: Date.now() - t1,
      details: isRedirect
        ? `Correctly redirected to /login (HTTP ${gatedRes.status})`
        : `Expected redirect, got HTTP ${gatedRes.status}`,
    });

    // Step 3: Auth surface render check
    const t2 = Date.now();
    const loginRes = await fetch(`${baseUrl}/login`, { method: "GET" });
    steps.push({
      name: "Auth Surface Availability",
      target: "GET /login",
      status: loginRes.ok ? "passed" : "failed",
      durationMs: Date.now() - t2,
      details: `HTTP ${loginRes.status} OK (form ready)`,
    });

    // Step 4: Seeded credential authentication, actually attempted.
    //
    // This step previously pushed a hardcoded `status: "passed"` without
    // authenticating anything. It now performs a real Supabase password grant
    // and reports the result, or an explicit "not executed" reason.
    const t3 = Date.now();
    const testUser = getTestUser();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (simulateFailure) {
      steps.push({
        name: "Seeded User Authentication",
        target: "POST /auth/v1/token?grant_type=password",
        status: "failed",
        durationMs: Date.now() - t3,
        details: "Simulated failure requested by the caller.",
      });
      return NextResponse.json({
        success: false,
        status: "failed",
        totalDurationMs: Date.now() - startTime,
        steps,
        failureReason: "Seeded test account authentication failed.",
      });
    }

    if (!testUser) {
      steps.push({
        name: "Seeded User Authentication",
        target: "POST /auth/v1/token?grant_type=password",
        status: "failed",
        durationMs: Date.now() - t3,
        details:
          "Not executed: TEST_USER_EMAIL / TEST_USER_PASSWORD are not configured for this deployment.",
      });
    } else if (!supabaseUrl || !supabaseKey) {
      steps.push({
        name: "Seeded User Authentication",
        target: `POST /auth/v1/token (${testUser.email})`,
        status: "failed",
        durationMs: Date.now() - t3,
        details:
          "Not executed: Supabase auth is not configured (NEXT_PUBLIC_SUPABASE_URL / key).",
      });
    } else {
      // Throwaway client with persistence disabled: this endpoint verifies that
      // the seeded account can authenticate and must not mint a session cookie
      // for the caller.
      const throwaway = createSupabaseClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await throwaway.auth.signInWithPassword({
        email: testUser.email,
        password: testUser.password,
      });
      const authPassed = !error && Boolean(data?.user);
      steps.push({
        name: "Seeded User Authentication",
        target: `POST /auth/v1/token (${testUser.email})`,
        status: authPassed ? "passed" : "failed",
        durationMs: Date.now() - t3,
        details: authPassed
          ? "HTTP 200 / session issued for the seeded account"
          : `Authentication failed: ${error?.message ?? "no user returned"}`,
      });
      if (!authPassed) {
        return NextResponse.json({
          success: false,
          status: "failed",
          totalDurationMs: Date.now() - startTime,
          steps,
          failureReason: "Seeded test account authentication failed.",
        });
      }
    }

    return NextResponse.json({
      success: true,
      status: "passed",
      totalDurationMs: Date.now() - startTime,
      steps,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        status: "failed",
        totalDurationMs: Date.now() - startTime,
        steps,
        error: err?.message || "Journey execution encountered unexpected error",
      },
      { status: 500 }
    );
  }
}
