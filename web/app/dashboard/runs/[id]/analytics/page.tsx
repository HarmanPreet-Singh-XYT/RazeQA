import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import JobAnalyticsClient from "./job-analytics-client";

export const metadata = {
  title: "Job Quality & Per-Path Analytics — RazeQA",
  description: "Detailed per-job quality dimension audit, per-path latency, accessibility scorecards, and AI remediation.",
};

export default async function JobAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  return <JobAnalyticsClient runId={id} userEmail={session} />;
}
