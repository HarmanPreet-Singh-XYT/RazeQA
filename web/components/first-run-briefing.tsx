"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RunConfigForm } from "@/components/run-config-form";
import type { RunDispatchRecord } from "@/lib/first-run";

interface FirstRunBriefingProps {
  repo: string;
  projectName?: string;
  defaultBranch: string;
  /** Project default, so the briefing does not silently override a saved choice. */
  defaultTestType?: string;
  onDispatched: (record: RunDispatchRecord) => void;
  /** Close for this session only. The briefing returns on the next visit. */
  onSkip: () => void;
}

/**
 * The one-time briefing for a project that has never been verified.
 *
 * Step 1 explains what a verification actually does; step 2 is the shared
 * `RunConfigForm`, so the way a first run is chosen is exactly the way every
 * later run is chosen.
 */
export function FirstRunBriefing({
  repo,
  projectName,
  defaultBranch,
  defaultTestType,
  onDispatched,
  onSkip,
}: FirstRunBriefingProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [isDispatching, setIsDispatching] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDispatching) onSkip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip, isDispatching]);

  const handleDispatched = (record: RunDispatchRecord) => {
    setIsDispatching(false);
    onDispatched(record);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-briefing-title"
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl my-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="first-run-briefing-title"
                className="text-base sm:text-lg font-bold text-slate-950 truncate"
              >
                Let&apos;s run your first verification
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                <span className="font-mono font-semibold text-slate-700">{repo}</span>
                {" · "}
                {projectName ? `${projectName} · ` : ""}
                branch <span className="font-mono font-semibold text-slate-700">{defaultBranch}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            disabled={isDispatching}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 disabled:opacity-50"
            aria-label="Not now"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-5 sm:px-6 pt-4">
          {[
            { id: 1 as const, label: "What will happen" },
            { id: 2 as const, label: "How to run it" },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => !isDispatching && setStep(s.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                step === s.id
                  ? "border-slate-900 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === s.id ? "bg-white text-slate-950" : "bg-slate-100 text-slate-500"
                }`}
              >
                {s.id}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {step === 1 && (
            <div className="space-y-5 animate-in fade-in-50">
              <p className="text-sm text-slate-600 leading-relaxed">
                This project has not been verified yet. AutoQA will boot your app in an isolated
                container, act as a real user in a headless Chromium browser, and record forensic
                proof of whatever it finds. Nothing is written to your repository.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    icon: Workflow,
                    title: "Boots a sandbox",
                    body: "Your commit is cloned inside a disposable container and started there.",
                  },
                  {
                    icon: ListChecks,
                    title: "Plans real journeys",
                    body: "Routes are discovered from your code, then visited and exercised like a user.",
                  },
                  {
                    icon: Video,
                    title: "Records the proof",
                    body: "Video, DOM snapshot, network log and a ready-to-paste fix prompt.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5"
                  >
                    <item.icon className="h-4 w-4 text-emerald-600" />
                    <p className="text-xs font-bold text-slate-900">{item.title}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex items-start gap-2.5 text-[11px] text-slate-600">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-800">This briefing appears once.</span>{" "}
                  It stays until a verification has actually been dispatched, then it is replaced by
                  your run dashboard. The same choices stay available from{" "}
                  <span className="font-semibold text-slate-800">Run verification</span> afterwards.
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={onSkip}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Not now — remind me next time
                </button>
                <Button
                  type="button"
                  onClick={() => setStep(2)}
                  className="bg-slate-950 hover:bg-slate-800 text-white font-semibold text-xs px-4 py-2 gap-1.5 cursor-pointer"
                >
                  <span>Choose how to run</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in fade-in-50">
              <RunConfigForm
                repo={repo}
                defaultBranch={defaultBranch}
                defaultTestType={defaultTestType}
                submitLabel="Run first verification"
                cancelLabel="Back"
                onCancel={() => setStep(1)}
                secondaryAction={{ label: "Not now", onClick: onSkip }}
                persistFirstRunMarker
                onDispatched={handleDispatched}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
