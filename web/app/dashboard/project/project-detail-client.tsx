"use client";

import React, { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard-context";
import { OverviewClient } from "../overview-client";

export function ProjectDetailClient({ userEmail }: { userEmail?: string }) {
  const searchParams = useSearchParams();
  const repoParam = searchParams.get("repo");
  const { setActiveRepo } = useDashboard();

  useEffect(() => {
    if (repoParam) {
      setActiveRepo(repoParam);
    }
  }, [repoParam, setActiveRepo]);

  return <OverviewClient userEmail={userEmail} />;
}
