import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Semantic status badge for run results and risk tags. Wraps the shared
 * success/warning/danger/info tokens so every place that renders a
 * Pass/Fail/Risk/Run state stays visually consistent.
 */
const statusBadgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase whitespace-nowrap",
  {
    variants: {
      status: {
        success: "border-emerald-200 bg-emerald-50 text-emerald-700",
        danger: "border-rose-200 bg-rose-50 text-rose-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        info: "border-sky-200 bg-sky-50 text-sky-700",
        running: "border-sky-200 bg-sky-50 text-sky-700 animate-pulse",
        queued: "border-amber-200 bg-amber-50 text-amber-700",
        superseded: "border-slate-300 bg-slate-100 text-slate-500",
        neutral: "border-slate-200 bg-slate-100 text-slate-600",
      },
    },
    defaultVariants: {
      status: "neutral",
    },
  }
)

export type StatusBadgeStatus = VariantProps<typeof statusBadgeVariants>["status"]

export const runStatusMap: Record<string, NonNullable<StatusBadgeStatus>> = {
  passed: "success",
  failed: "danger",
  running: "running",
  queued: "queued",
  superseded: "superseded",
  flaky: "warning",
  skipped: "neutral",
}

export const riskLevelMap: Record<string, NonNullable<StatusBadgeStatus>> = {
  low: "success",
  medium: "warning",
  high: "danger",
}

function StatusBadge({
  className,
  status,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    />
  )
}

/**
 * Convenience component that takes a raw run status string (passed, failed, running, queued, etc.)
 * and renders the correctly styled badge.
 */
function RunStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const normalized = (status || "").toLowerCase();
  const badgeStatus = runStatusMap[normalized] || "neutral";
  const label = normalized.toUpperCase() || "UNKNOWN";

  return (
    <StatusBadge status={badgeStatus} className={className}>
      {badgeStatus === "running" && (
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-ping inline-block mr-0.5" />
      )}
      {label}
    </StatusBadge>
  );
}

export { StatusBadge, RunStatusBadge, statusBadgeVariants }
