"use client";

import React, { Suspense } from "react";
import { DashboardProvider } from "./dashboard-context";
import { DashboardNav } from "./dashboard-nav";

interface DashboardShellProps {
  children: React.ReactNode;
  userEmail: string | null;
  initialRepo?: string | null;
}

export function DashboardShell({
  children,
  userEmail,
  initialRepo,
}: DashboardShellProps) {
  return (
    <DashboardProvider userEmail={userEmail} initialRepo={initialRepo}>
      <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
        <DashboardNav>{children}</DashboardNav>
      </Suspense>
    </DashboardProvider>
  );
}
