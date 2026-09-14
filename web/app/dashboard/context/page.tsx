import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ContextSecretsClient } from "./context-client";

export const metadata = {
  title: "Context & Secrets — RazeQA",
  description: "Per-repository variables, encrypted secrets, and seed data used during a run.",
};

export default async function ContextSecretsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading context...
        </div>
      }
    >
      <ContextSecretsClient />
    </Suspense>
  );
}
