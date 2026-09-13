"use client";

import React, { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard-context";
import { OverviewClient } from "../overview-client";

export function ProjectDetailClient({ userEmail }: { userEmail?: string }) {
  const searchParams = useSearchParams();
  const repoParam = searchParams.get("repo");
  // Set by the import flow. It means "this project was just created", so the
  // first-run briefing must not wait for the runs API to authoritatively answer
  // (it never does while the engine is unreachable).
  const promptFirstRun = searchParams.get("firstRun") === "1";
  const { setActiveRepo } = useDashboard();

  useEffect(() => {
    if (repoParam) {
      setActiveRepo(repoParam);
    }
  }, [repoParam, setActiveRepo]);

  return <OverviewClient userEmail={userEmail} promptFirstRun={promptFirstRun} />;
}
