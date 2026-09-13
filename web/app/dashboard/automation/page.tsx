import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AutomationClient } from "./automation-client";

export const metadata = {
  title: "Automation — AutoQA",
  description: "Control when each repository is reviewed and whether results are posted back to GitHub.",
};

export default async function AutomationPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading automation settings...
        </div>
      }
    >
      <AutomationClient />
    </Suspense>
  );
}
