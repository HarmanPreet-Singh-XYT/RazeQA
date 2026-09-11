import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: projects, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ projects: projects || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const SAFE_BUILD_BINARIES = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "pytest",
  "python",
  "python3",
  "cargo",
  "go",
  "make",
];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate user session (Fix Finding #5)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // In local dev without Supabase Auth keys, allow bypass only if explicitly disabled
    const hasSupabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const isDevNoAuth = process.env.NODE_ENV === "development" && !hasSupabaseKey;
    if (!user && !isDevNoAuth) {
      return NextResponse.json(
        { error: "Unauthorized: You must be logged in to modify project settings." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { repo_full_name, settings } = body;

    if (!repo_full_name) {
      return NextResponse.json({ error: "repo_full_name is required" }, { status: 400 });
    }

    // 2. Server-side command-injection validation (Fix Finding #4)
    const buildCmd = (settings?.auto_repair?.build_command || "").trim();
    if (buildCmd) {
      for (const op of [";", "&&", "||", "|", "`", "$", "\n", "\r", ">", "<"]) {
        if (buildCmd.includes(op)) {
          return NextResponse.json(
            { error: `Invalid build_command: contains disallowed operator '${op}'` },
            { status: 400 }
          );
        }
      }
      const binary = buildCmd.split(/\s+/)[0]?.replace(/^.*\//, "");
      if (binary && !SAFE_BUILD_BINARIES.includes(binary)) {
        return NextResponse.json(
          { error: `Invalid build_command: binary '${binary}' is not permitted.` },
          { status: 400 }
        );
      }
    }

    // 3. Credential-clobbering protection (Fix Finding #2)
    // Fetch existing settings to preserve real passwords when the UI submits masked "••••••••••••"
    const { data: existingProject } = await supabase
      .from("projects")
      .select("settings")
      .eq("repo_full_name", repo_full_name)
      .maybeSingle();

    const mergedSettings = { ...(settings || {}) };
    if (existingProject?.settings?.roles && mergedSettings.roles) {
      const existingRoles = existingProject.settings.roles;
      for (const [rKey, rVal] of Object.entries(mergedSettings.roles as Record<string, any>)) {
        if (!rVal.password || rVal.password === "••••••••••••") {
          const preserved = existingRoles[rKey]?.password;
          if (preserved && preserved !== "••••••••••••") {
            rVal.password = preserved;
          }
        }
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .upsert(
        {
          repo_full_name,
          settings: mergedSettings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "repo_full_name" }
      )
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: "saved", project: data?.[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

