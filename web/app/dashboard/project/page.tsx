import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ProjectDetailClient } from "./project-detail-client";

export const metadata = {
  title: "Project Details — RazeQA",
  description: "Automated test runs, synthetic user journeys, live sandbox verification, and AI fix proposals.",
};

export default async function ProjectDetailPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading project workspace...
        </div>
      }
    >
      <ProjectDetailClient userEmail={session} />
    </Suspense>
  );
}
