import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardOverviewClient } from "./dashboard-overview-client";

export const metadata = {
  title: "Overview — Projects & Activity — AutoQA",
  description: "Vercel-style workspace overview showing all repositories, domains, commits, and autonomous QA health.",
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <DashboardOverviewClient userEmail={session} />;
}

