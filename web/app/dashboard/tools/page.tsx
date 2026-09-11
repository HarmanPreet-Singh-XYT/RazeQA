import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ToolsDashboardClient from "./tools-dashboard-client";

export const metadata = {
  title: "Webmaster & Developer Tools — AutoQA",
  description:
    "Integrated developer utilities suite for webmasters: CSP builder, JWT debugger, CORS tester, fluid typography, schema builder, and cURL transpiler.",
};

export default async function DashboardToolsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <ToolsDashboardClient userEmail={session} />;
}
