import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TestsClient } from "./tests-client";

export const metadata = {
  title: "Tests — AutoQA",
  description: "The reusable regression suite the agent exercises on every run.",
};

export default async function TestsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading tests...
        </div>
      }
    >
      <TestsClient />
    </Suspense>
  );
}
