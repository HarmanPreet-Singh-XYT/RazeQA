import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AgentChatClient } from "./agent/agent-chat-client";

export const metadata = {
  title: "Copilot — RazeQA",
  description:
    "The RazeQA agent: read runs, findings, pull requests, and analytics, and act on them with per-session controls.",
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // The copilot reads `?repo=` (the active project scope) via useSearchParams,
  // which needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading copilot...</div>}>
      <AgentChatClient userEmail={session} />
    </Suspense>
  );
}
