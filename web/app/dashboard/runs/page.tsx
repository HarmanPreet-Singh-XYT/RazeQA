import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { RunsClient } from "./runs-client";

export default async function RunsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <RunsClient userEmail={session} />;
}
