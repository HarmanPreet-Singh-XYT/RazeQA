import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: projects, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !projects || projects.length === 0) {
      // Return default connected project for the active workspace demo
      return NextResponse.json({
        projects: [
          {
            id: "proj-default-ecommerce",
            repo_full_name: "acme-corp/ecommerce-web",
            settings: {
              framework: "nextjs",
              package_manager: "npm",
              build_command: "npm run build",
              start_command: "npm start",
              port: 3000,
              scope: "changed",
              test_type: "functional",
              enable_on_push: true,
              enable_on_pr: true,
              roles: {
                user: { email: "qa@example.com", password: "••••••••••••" },
                admin: { email: "admin@example.com", password: "••••••••••••" },
              },
            },
          },
        ],
      });
    }

    return NextResponse.json({ projects });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repo_full_name, settings } = body;

    if (!repo_full_name) {
      return NextResponse.json({ error: "repo_full_name is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .upsert(
        {
          repo_full_name,
          settings: settings || {},
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
