import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PullRequestsClient } from "./pull-requests-client";

export const metadata = {
  title: "Pull Requests — AutoQA",
  description:
    "Every pull request tested at runtime, with severity-ranked findings, test cases and evidence.",
};

export default async function PullRequestsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading pull requests...
        </div>
      }
    >
      <PullRequestsClient />
    </Suspense>
  );
}
