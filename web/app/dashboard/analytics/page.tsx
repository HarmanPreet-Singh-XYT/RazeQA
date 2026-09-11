import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AnalyticsClient from "./analytics-client";

export const metadata = {
  title: "Fleet Quality Dimensions & AI Intelligence",
  description:
    "Fleet-wide non-functional quality attributes, predictive regression forecasting, and multi-path performance scorecards.",
};

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <AnalyticsClient userEmail={session} />;
}
