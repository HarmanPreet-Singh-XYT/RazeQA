import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import UserJourneysClient from "./user-journeys-client";

export const metadata = {
  title: "Synthetic User Journeys — RazeQA",
  description:
    "Autonomous multi-step user experience journey test suites, assertion traces, and responsive crawl verification.",
};

export default async function DashboardToolsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <UserJourneysClient userEmail={session} />;
}
