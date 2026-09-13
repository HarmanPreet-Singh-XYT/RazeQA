"use client";

import React from "react";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ServerOff,
  KeyRound,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApplyFix } from "@/lib/use-apply-fix";

interface ApplyFixButtonProps {
  runId: string;
  onSuccess?: () => void;
  className?: string;
  buttonLabel?: string;
  status?: string;
  fixProposals?: any[];
}

export function ApplyFixButton({
  runId,
  onSuccess,
  className,
  buttonLabel = "Apply Fix to PR",
}: ApplyFixButtonProps) {
  const { isApplying, isSuccess, appliedVia, error, errorType, applyFix, clearError } =
    useApplyFix(runId, onSuccess);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={applyFix}
          disabled={isApplying}
          className={`bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 py-1.5 h-8 gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer ${
            className || ""
          }`}
        >
          {isApplying ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Applying Patch to PR…</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              <span>{buttonLabel}</span>
            </>
          )}
        </Button>

        {isSuccess && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold animate-in fade-in-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>
              {appliedVia === "github_contents_api"
                ? "Patch committed to the PR branch!"
                : "Patch applied to the local working tree; re-verification enqueued."}
            </span>
          </span>
        )}
      </div>

      {/* Explanatory Error Callout */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border p-3.5 text-xs shadow-xs animate-in fade-in-50 duration-200 border-amber-200 bg-amber-50/90 text-amber-900"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5">
              {errorType === "missing_api_key" ? (
                <KeyRound className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              ) : errorType === "backend_unreachable" ? (
                <ServerOff className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-bold text-slate-900">
                  {errorType === "missing_api_key"
                    ? "Backend Not Connected (Missing AGENT_API_KEY)"
                    : errorType === "backend_unreachable"
                    ? "AutoQA Engine Unreachable"
                    : "Failed to Apply Fix"}
                </div>
                <div className="text-[11px] text-slate-700 leading-relaxed">
                  {errorType === "missing_api_key" ? (
                    <>
                      The web client cannot trigger the autonomous repair agent because{" "}
                      <code className="bg-amber-100/80 px-1 py-0.2 rounded font-mono font-bold text-amber-900">
                        AGENT_API_KEY
                      </code>{" "}
                      is unset in your environment. Add your key to <code className="font-mono text-slate-900">agent/.env</code> and <code className="font-mono text-slate-900">web/.env</code>, then restart the services.
                    </>
                  ) : errorType === "backend_unreachable" ? (
                    <>
                      Unable to reach the PR Testing Engine on <code className="font-mono text-slate-900">http://localhost:8000</code>. Ensure the Python agent backend is actively running.
                    </>
                  ) : (
                    error
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={clearError}
              aria-label="Dismiss message"
              className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
