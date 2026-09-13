import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PullRequestDetailClient } from "./pull-request-detail-client";

export const metadata = {
  title: "Pull Request Detail — AutoQA",
  description: "Structured test cases, severity, reproduction steps and evidence for one pull request.",
};

export default async function PullRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading pull request...
        </div>
      }
    >
      <PullRequestDetailClient id={id} />
    </Suspense>
  );
}
