import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { NotificationsClient } from "./notifications-client";

export const metadata = {
  title: "Notifications — RazeQA",
  description: "Choose who is emailed when a verification, finding, review or fix needs attention.",
};

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          Loading notification settings...
        </div>
      }
    >
      <NotificationsClient />
    </Suspense>
  );
}
