import { Suspense } from "react";
import ProjectsClient from "./projects-client";

export const metadata = {
  title: "Projects & Settings — RazeQA",
  description: "Configure GitHub App onboarding, multi-role test credentials, and automated testing policies.",
};

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading settings...</div>}>
      <ProjectsClient />
    </Suspense>
  );
}
