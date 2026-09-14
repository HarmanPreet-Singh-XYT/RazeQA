import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared loading primitives.
 *
 * The dashboard fetches almost everything client-side, so a view that renders
 * its empty state while a request is still in flight reads as "there is no
 * data" rather than "we are still loading". These primitives give every view a
 * consistent way to say the latter. They are deliberately layout-shaped
 * (skeletons that mirror the real content) instead of a bare spinner so the
 * page does not jump when the data lands.
 */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500",
        className
      )}
    />
  );
}

export function InlineLoading({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 p-8 text-xs text-slate-500",
        className
      )}
    >
      <Spinner className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonList({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white",
        className
      )}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2.5 p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40 max-w-[45%]" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/**
 * Full-page placeholder used by route-level `loading.tsx` boundaries and by
 * views whose whole body is still loading.
 */
export function PageSkeleton({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "mx-auto w-full max-w-7xl space-y-6 p-4 text-slate-900 sm:p-6 lg:p-8",
        className
      )}
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-2 border-b border-slate-200 pb-5">
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-3 w-96 max-w-full" />
      </div>
      <SkeletonCards count={4} />
      <SkeletonList rows={5} />
    </div>
  );
}
