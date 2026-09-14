import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { RunDetailClient } from "./run-detail-client";

export const metadata = {
  title: "Test Run Detail — RazeQA",
  description:
    "Every test case in one run, with its recording, reproduction steps, mock context, code analysis and downloadable artifacts.",
};

export default async function RunDetailPage({
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
          Loading test run...
        </div>
      }
    >
      <RunDetailClient runId={id} />
    </Suspense>
  );
}
