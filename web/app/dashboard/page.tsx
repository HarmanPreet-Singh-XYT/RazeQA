import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { OverviewClient } from "./overview-client";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <OverviewClient userEmail={session} />;
}
