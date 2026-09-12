import * as React from "react";
import { cn } from "cn";

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  isEstimate?: boolean;
  estimateLabel?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function StatTile({
  label,
  value,
  subtext,
  isEstimate = false,
  estimateLabel = "~est.",
  icon,
  badge,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition-all hover:border-slate-300",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-medium text-slate-500 truncate">
          {label}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {isEstimate && (
            <span
              title="Estimated metric based on historical run telemetry"
              className="rounded bg-amber-50 border border-amber-200/80 px-1 py-0.2 text-[9px] font-mono font-bold text-amber-700 tracking-wider"
            >
              {estimateLabel}
            </span>
          )}
          {badge}
          {icon && <div className="text-slate-400">{icon}</div>}
        </div>
      </div>

      <div className="text-base sm:text-lg font-bold text-slate-900 tracking-tight font-mono">
        {value}
      </div>

      {subtext && (
        <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
          {subtext}
        </div>
      )}
    </div>
  );
}
