"use client";

import React, { useEffect } from "react";
import { GitBranch, Play, X } from "lucide-react";
import { RunConfigForm } from "@/components/run-config-form";
import type { RunDispatchRecord } from "@/lib/first-run";

/**
 * The everyday "how do you want to run this?" dialog.
 *
 * Opened from the project page's verify button, so an on-demand run gets the
 * same four choices the first-run briefing offers instead of being silently
 * fixed to "changed + functional".
 */
export function RunConfigDialog({
  isOpen,
  repo,
  projectName,
  defaultBranch,
  defaultTestType,
  onClose,
  onDispatched,
}: {
  isOpen: boolean;
  repo: string;
  projectName?: string;
  defaultBranch: string;
  defaultTestType?: string;
  onClose: () => void;
  onDispatched: (record: RunDispatchRecord) => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-config-title"
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl my-auto"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
              <Play className="h-4 w-4 fill-current" />
            </div>
            <div className="min-w-0">
              <h2 id="run-config-title" className="text-base sm:text-lg font-bold text-slate-950 truncate">
                Run a verification
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 min-w-0">
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="font-mono font-semibold text-slate-700 truncate">{repo}</span>
                {projectName ? <span className="truncate">· {projectName}</span> : null}
                <span>
                  · branch <span className="font-mono font-semibold text-slate-700">{defaultBranch}</span>
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6">
          <RunConfigForm
            repo={repo}
            defaultBranch={defaultBranch}
            defaultTestType={defaultTestType}
            submitLabel="Run verification"
            cancelLabel="Cancel"
            onCancel={onClose}
            onDispatched={onDispatched}
          />
        </div>
      </div>
    </div>
  );
}
