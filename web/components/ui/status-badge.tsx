import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Semantic status badge for run results and risk tags. Wraps the shared
 * success/warning/danger/info tokens from app/globals.css so every place
 * that renders a Pass/Fail/Risk state stays visually consistent.
 */
const statusBadgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      status: {
        success: "bg-success-muted text-success",
        warning: "bg-warning-muted text-warning",
        danger: "bg-danger-muted text-danger",
        info: "bg-info-muted text-info",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      status: "neutral",
    },
  }
)

export type StatusBadgeStatus = VariantProps<typeof statusBadgeVariants>["status"]

/** Maps the domain-level result/risk vocabulary onto the visual status scale. */
export const runStatusMap = {
  passed: "success",
  failed: "danger",
  flaky: "warning",
  skipped: "neutral",
} as const satisfies Record<string, StatusBadgeStatus>

export const riskLevelMap = {
  low: "success",
  medium: "warning",
  high: "danger",
} as const satisfies Record<string, StatusBadgeStatus>

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

export { StatusBadge, statusBadgeVariants }
