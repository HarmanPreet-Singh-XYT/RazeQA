import { PageSkeleton } from "@/components/loading-state";

/**
 * Route-level loading UI for the whole dashboard segment.
 *
 * Covers the server round-trip (session lookup) plus the initial render of any
 * child page, so navigating between dashboard sections always shows structure
 * instead of a frozen frame.
 */
export default function DashboardLoading() {
  return <PageSkeleton label="Loading dashboard…" />;
}
