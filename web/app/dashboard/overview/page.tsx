import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardOverviewClient } from "./dashboard-overview-client";

export const metadata = {
  title: "Overview — Projects & Activity — RazeQA",
  description:
    "Vercel-style workspace overview showing all repositories, domains, commits, and autonomous QA health.",
};

export default async function OverviewPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // The overview reads `?deleted=` (set when a project is deleted from Project
  // Settings) via useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense
      fallback={<div className="p-8 text-xs text-slate-500">Loading workspace overview...</div>}
    >
      <DashboardOverviewClient userEmail={session} />
    </Suspense>
  );
}
