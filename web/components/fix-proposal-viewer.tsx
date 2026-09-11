"use client";

import React, { useState } from "react";
import {
  Check,
  Copy,
  GitPullRequest,
  Sparkles,
  Code2,
  Terminal,
  Loader2,
  Palette,
  Cpu,
  Layers,
  FileCode,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type TrajectoryStep = {
  step: number;
  thought?: string;
  command: string;
  returncode: number;
  output?: string;
  duration_ms?: number;
  guardrail_passed?: boolean;
};

export type FilePatch = {
  file_path: string;
  original_snippet?: string;
  replacement_snippet?: string;
  unified_diff?: string;
  explanation?: string;
};

export type FixProposalData = {
  summary?: string;
  target_files: string[];
  paradigm?: "tailwind" | "css_modules" | "css_in_js" | "inline_style" | "vanilla_css" | "logic" | string;
  patches: FilePatch[];
  unified_diff?: string;
  suggested_change?: string;
  explanation?: string;
  // Agentic repair fields
  repair_trajectory?: TrajectoryStep[];
  build_passed?: boolean;
  build_command?: string;
  build_output?: string;
  steps_taken?: number;
  max_steps?: number;
  total_cost_usd?: number;
};

interface FixProposalViewerProps {
  runId: string;
  branch: string;
  proposals: FixProposalData[];
  onFixApplied?: () => void;
}

export function FixProposalViewer({
  runId,
  branch,
  proposals,
  onFixApplied,
}: FixProposalViewerProps) {
  const [selectedProposalIdx, setSelectedProposalIdx] = useState(0);
  const [viewMode, setViewMode] = useState<"diff" | "suggestion" | "trajectory">("diff");
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<"bot" | "cli" | "diff" | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    success: boolean;
    message: string;
    newRunId?: string;
  } | null>(null);

  if (!proposals || proposals.length === 0) {
    return null;
  }

  const proposal = proposals[selectedProposalIdx] || proposals[0];

  const handleCopy = (text: string, type: "bot" | "cli" | "diff") => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(type);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleApplyFix = async () => {
    setIsApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/runs/${runId}/apply`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.status === "applied") {
        setApplyResult({
          success: true,
          message: data.message || "Fix successfully committed! Re-verification enqueued.",
          newRunId: data.new_run_id,
        });
        if (onFixApplied) {
          onFixApplied();
        }
      } else {
        setApplyResult({
          success: false,
          message: data.detail || data.error || "Failed to apply fix.",
        });
      }
    } catch (err: any) {
      setApplyResult({
        success: false,
        message: err?.message || "Network error communicating with server.",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const getParadigmBadge = (paradigm: string) => {
    switch (paradigm.toLowerCase()) {
      case "tailwind":
        return {
          label: "Tailwind CSS",
          bg: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800",
          icon: <Palette className="w-3.5 h-3.5 mr-1" />,
        };
      case "css_modules":
        return {
          label: "CSS Modules",
          bg: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
          icon: <Layers className="w-3.5 h-3.5 mr-1" />,
        };
      case "css_in_js":
        return {
          label: "CSS-in-JS",
          bg: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
          icon: <Palette className="w-3.5 h-3.5 mr-1" />,
        };
      case "inline_style":
        return {
          label: "Inline Styles",
          bg: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
          icon: <FileCode className="w-3.5 h-3.5 mr-1" />,
        };
      case "vanilla_css":
        return {
          label: "Vanilla CSS",
          bg: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
          icon: <FileCode className="w-3.5 h-3.5 mr-1" />,
        };
      case "logic":
      default:
        return {
          label: "Logic & State",
          bg: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
          icon: <Cpu className="w-3.5 h-3.5 mr-1" />,
        };
    }
  };

  const badge = getParadigmBadge(proposal.paradigm || "logic");
  const rawDiff = proposal.unified_diff || "";
  const diffLines = rawDiff.split("\n");

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900">
      {/* Header Banner */}
      <div className="border-b border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  AI Synthesized Code Fix
                </h3>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${badge.bg}`}
                >
                  {badge.icon}
                  {badge.label}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Target:{" "}
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                  {proposal.target_files.join(", ")}
                </span>
              </p>
            </div>
          </div>

          {/* Action Trigger Buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleApplyFix}
              disabled={isApplying}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm"
            >
              {isApplying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Applying to PR...</span>
                </>
              ) : (
                <>
                  <GitPullRequest className="h-3.5 w-3.5" />
                  <span>Apply Fix to PR</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Apply Feedback Alert */}
        {applyResult && (
          <div
            className={`mt-3 p-3 rounded-lg text-xs flex items-center gap-2 ${
              applyResult.success
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
            }`}
          >
            {applyResult.success ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <div className="flex-1">
              <span>{applyResult.message}</span>
              {applyResult.newRunId && (
                <span className="font-mono ml-2 font-semibold">
                  (New Run: {applyResult.newRunId})
                </span>
              )}
            </div>
          </div>
        )}

        {/* Multiple Proposals Selector (if > 1) */}
        {proposals.length > 1 && (
          <div className="mt-3 flex items-center gap-1.5 border-t border-slate-200/60 pt-2 dark:border-slate-800">
            <span className="text-xs text-slate-500 font-medium">Proposals:</span>
            {proposals.map((p, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedProposalIdx(idx)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  idx === selectedProposalIdx
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Option {idx + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Proposal Summary & Explanation */}
      <div className="p-4 border-b border-slate-100 bg-white dark:bg-slate-900 dark:border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
            <span className="font-semibold text-slate-900 dark:text-white">Summary: </span>
            {proposal.summary || proposal.explanation || "Autonomous code repair synthesized."}
          </p>

          {/* Verification & Resource Meter Chips */}
          <div className="flex items-center gap-2 text-[11px]">
            {proposal.build_command && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-medium border ${
                  proposal.build_passed
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                }`}
              >
                {proposal.build_passed ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                )}
                {proposal.build_passed ? "Build Verified: 0 Errors" : "Build Verification Pending"}
              </span>
            )}

            {proposal.steps_taken !== undefined && (
              <span className="bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 px-2 py-0.5 rounded font-mono">
                {proposal.steps_taken}/{proposal.max_steps || 10} steps
              </span>
            )}

            {proposal.total_cost_usd !== undefined && proposal.total_cost_usd > 0 && (
              <span className="bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 px-2 py-0.5 rounded font-mono">
                ${proposal.total_cost_usd.toFixed(4)}
              </span>
            )}
          </div>
        </div>

        {proposal.explanation && (
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Analysis: </span>
            {proposal.explanation}
          </p>
        )}
      </div>

      {/* Diff / Trajectory Controls Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 text-slate-300 border-b border-slate-800 text-xs font-mono">
        <div className="flex items-center gap-2">
          {viewMode === "trajectory" ? (
            <Terminal className="w-4 h-4 text-emerald-400" />
          ) : (
            <Code2 className="w-4 h-4 text-indigo-400" />
          )}
          <span>
            {viewMode === "trajectory"
              ? "Autonomous Agent Trajectory (Bash execution stream)"
              : proposal.target_files[0] || "patch.diff"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode("diff")}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              viewMode === "diff"
                ? "bg-slate-700 text-white font-semibold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Unified Diff
          </button>
          <button
            onClick={() => setViewMode("suggestion")}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              viewMode === "suggestion"
                ? "bg-slate-700 text-white font-semibold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            GitHub Suggestion
          </button>
          {proposal.repair_trajectory && proposal.repair_trajectory.length > 0 && (
            <button
              onClick={() => setViewMode("trajectory")}
              className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                viewMode === "trajectory"
                  ? "bg-slate-700 text-white font-semibold"
                  : "text-emerald-400 hover:text-emerald-300"
              }`}
            >
              <Terminal className="w-3 h-3" />
              Agent Trajectory ({proposal.repair_trajectory.length})
            </button>
          )}
          {viewMode !== "trajectory" && (
            <button
              onClick={() =>
                handleCopy(
                  viewMode === "diff"
                    ? rawDiff
                    : proposal.suggested_change || rawDiff,
                  "diff"
                )
              }
              className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              title="Copy diff to clipboard"
            >
              {copiedCmd === "diff" ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body View: Diff or Trajectory */}
      <div className="max-h-80 overflow-y-auto bg-slate-950 font-mono text-xs text-slate-200">
        {viewMode === "trajectory" ? (
          <div className="p-3 space-y-2">
            {proposal.repair_trajectory && proposal.repair_trajectory.length > 0 ? (
              proposal.repair_trajectory.map((t, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-800 bg-slate-900/90 overflow-hidden"
                >
                  <div
                    onClick={() => setExpandedStep(expandedStep === idx ? null : idx)}
                    className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-slate-400 font-bold px-1.5 py-0.5 rounded bg-slate-800">
                        #{t.step}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          t.returncode === 0
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : "bg-rose-950 text-rose-400 border border-rose-800"
                        }`}
                      >
                        exit {t.returncode}
                      </span>
                      <code className="text-xs text-slate-200 font-mono truncate">
                        {t.command}
                      </code>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {t.duration_ms !== undefined && (
                        <span className="text-[10px] text-slate-500">
                          {t.duration_ms.toFixed(0)}ms
                        </span>
                      )}
                      <span className="text-slate-500 text-[10px]">
                        {expandedStep === idx ? "▼ Hide" : "▶ View Output"}
                      </span>
                    </div>
                  </div>

                  {expandedStep === idx && (
                    <div className="border-t border-slate-800 bg-black/70 p-3 space-y-2">
                      {t.thought && (
                        <div className="text-[11px] text-indigo-300 font-sans italic bg-indigo-950/30 border border-indigo-900/50 p-2 rounded">
                          <span className="font-semibold not-italic">Thought: </span>
                          {t.thought}
                        </div>
                      )}
                      <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-all leading-relaxed font-mono">
                        {t.output || "(Command produced no stdout/stderr)"}
                      </pre>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-slate-500 italic">
                No trajectory steps recorded for this repair.
              </div>
            )}
          </div>
        ) : viewMode === "diff" ? (
          <table className="w-full border-collapse">
            <tbody>
              {diffLines.map((line, idx) => {
                let rowBg = "";
                let textColor = "text-slate-300";
                let prefixColor = "text-slate-500";

                if (line.startsWith("+") && !line.startsWith("+++")) {
                  rowBg = "bg-emerald-950/40 border-l-2 border-emerald-500";
                  textColor = "text-emerald-300";
                  prefixColor = "text-emerald-400 font-bold";
                } else if (line.startsWith("-") && !line.startsWith("---")) {
                  rowBg = "bg-rose-950/40 border-l-2 border-rose-500";
                  textColor = "text-rose-300";
                  prefixColor = "text-rose-400 font-bold";
                } else if (line.startsWith("@@")) {
                  rowBg = "bg-sky-950/30";
                  textColor = "text-sky-300 font-medium";
                  prefixColor = "text-sky-400";
                }

                return (
                  <tr key={idx} className={`${rowBg} leading-5`}>
                    <td className="w-10 select-none px-2 text-right text-[11px] text-slate-600 border-r border-slate-800">
                      {idx + 1}
                    </td>
                    <td className="px-3 whitespace-pre font-mono">
                      <span className={prefixColor}>{line.charAt(0)}</span>
                      <span className={textColor}>{line.slice(1)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-4 whitespace-pre-wrap leading-relaxed text-slate-300">
            {proposal.suggested_change || (
              <div className="text-slate-500 italic">
                No suggestion block available. Review Unified Diff tab.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Interactive Command Callouts & Quick Copy */}
      <div className="border-t border-slate-200 bg-slate-50/60 p-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs dark:border-slate-800 dark:bg-slate-900/60">
        {/* GitHub PR Bot Action */}
        <div className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800/80">
          <div className="flex items-center gap-2 overflow-hidden">
            <GitPullRequest className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="truncate">
              <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                GitHub PR Comment
              </span>
              <code className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                @pr-agent apply
              </code>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => handleCopy("@pr-agent apply", "bot")}
          >
            {copiedCmd === "bot" ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>

        {/* Local CLI Command */}
        <div className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800/80">
          <div className="flex items-center gap-2 overflow-hidden">
            <Terminal className="w-4 h-4 text-indigo-600 shrink-0" />
            <div className="truncate">
              <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                Local CLI Apply
              </span>
              <code className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                agent-bridge apply-fix {runId}
              </code>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() =>
              handleCopy(`agent-bridge apply-fix ${runId}`, "cli")
            }
          >
            {copiedCmd === "cli" ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
