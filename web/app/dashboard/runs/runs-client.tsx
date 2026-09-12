"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Layers,
  Search,
  ChevronDown,
  GitBranch,
  GitPullRequest,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  Sparkles,
  Terminal,
  Video,
  Download,
  RotateCcw,
  Globe,
  X,
  Play,
  ArrowUpRight,
  Shield,
  FileCode2,
  RefreshCw,
  GitCommit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";
import { CustomVideoPlayer } from "@/components/custom-video-player";
import { ApplyFixButton } from "@/components/apply-fix-button";
import { FixProposalViewer } from "@/components/fix-proposal-viewer";

export type TestRunRecord = {
  id: string;
  commitMsg: string;
  status: "Passed" | "Failed" | "Running" | "Cached" | "Queued";
  duration: string;
  hash: string;
  branch: string;
  prNumber?: number;
  prUrl?: string;
  date: string;
  author: string;
  targetUrl: string;
  scope: "changed" | "full";
  testType: string;
  passedCount: number;
  failedCount: number;
  hasTrace?: boolean;
  hasVideo?: boolean;
  videoUrl?: string;
  traceUrl?: string;
  consoleErrors?: string[];
  remediationPrompt?: string;
  fixProposals?: any[];
};

export function RunsClient({ userEmail }: { userEmail: string }) {
  const { activeRepo } = useDashboard();
  const [runs, setRuns] = useState<TestRunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Passed" | "Failed" | "main" | "pr">("All");

  // Forensics Modal
  const [selectedRun, setSelectedRun] = useState<TestRunRecord | null>(null);
  const [isForensicsOpen, setIsForensicsOpen] = useState(false);

  const loadRuns = async () => {
    try {
      const repoParam = activeRepo ? `?repo=${encodeURIComponent(activeRepo)}` : "";
      const res = await fetch(`/api/runs${repoParam}`);
      if (res.ok) {
        const data = await res.json();
        const rawRuns = Array.isArray(data) ? data : data.runs || [];
        const mapped: TestRunRecord[] = rawRuns.map((r: any) => {
          const result = r.result || {};
          const isFailed = r.status === "failed" || result.status === "failure";
          const isRunning = r.status === "running";
          const isQueued = r.status === "queued";
          const status: TestRunRecord["status"] = isRunning
            ? "Running"
            : isQueued
            ? "Queued"
            : isFailed
            ? "Failed"
            : "Passed";

          const durationText = result.duration_s
            ? `${Number(result.duration_s).toFixed(1)}s`
            : r.duration || "0s";

          const dateStr = r.created_at
            ? new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Recent";

          return {
            id: r.id || r.run_id || `run-${Date.now()}`,
            commitMsg: r.commitMsg || r.message || result.summary || `Autonomous verification for ${r.branch || "main"}`,
            status,
            duration: durationText,
            hash: (r.sha || "HEAD").slice(0, 7),
            branch: r.branch || "main",
            prNumber: r.prNumber || (r.pr_number ? parseInt(r.pr_number, 10) : undefined),
            prUrl: r.prUrl || r.pr_url,
            date: dateStr,
            author: r.triggeringUser || r.author || (r.scope === "external" ? "External Site Tester" : "AutoQA Agent"),
            targetUrl: r.target_url || result.target_url || "",
            scope: r.scope || "changed",
            testType: r.testType || r.test_type || "functional",
            passedCount: result.passed_journeys?.length ?? r.bucketCounts?.passed ?? 0,
            failedCount: result.failed_journeys?.length ?? r.bucketCounts?.failed ?? 0,
            hasTrace: !!(r.trace_url || r.artifacts?.traceUrl || result.trace_url),
            hasVideo: !!(r.video_url || r.artifacts?.videoUrl || result.video_url),
            videoUrl: r.video_url || r.artifacts?.videoUrl || result.video_url,
            traceUrl: r.trace_url || r.artifacts?.traceUrl || result.trace_url,
            consoleErrors: result.console_errors || r.additionalFindingsDetails || [],
            remediationPrompt: result.remediation_prompt || r.remediationPrompt,
            fixProposals: result.fix_proposals || r.fixProposals || [],
          };
        });
        setRuns(mapped);
      }
    } catch (err) {
      console.error("Failed to load runs", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 4000);
    return () => clearInterval(interval);
  }, [activeRepo]);

  const handleTriggerRun = async () => {
    setIsTriggering(true);
    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: activeRepo || "HarmanPreet-Singh-XYT/pingroute-web",
          branch: "main",
          scope: "changed",
          test_type: "functional",
        }),
      });
      await loadRuns();
    } catch {}
    finally {
      setIsTriggering(false);
    }
  };

  const filteredRuns = runs.filter((r) => {
    const matchesQuery =
      r.commitMsg.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.branch.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.hash.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesQuery) return false;

    if (statusFilter === "Passed") return r.status === "Passed";
    if (statusFilter === "Failed") return r.status === "Failed";
    if (statusFilter === "main") return r.branch === "main";
    if (statusFilter === "pr") return !!r.prNumber;

    return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full animate-in fade-in-50 duration-200">
      {/* Header & Action Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950 flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-slate-900" />
            <span>Test Runs &amp; Verifications</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Historical audit log of all automated Playwright test runs, regression verifications, and AI patches for{" "}
            <span className="font-mono font-semibold text-slate-700">{activeRepo || "active repository"}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleTriggerRun}
            disabled={isTriggering}
            className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
          >
            {isTriggering ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Dispatching...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Trigger Verification</span>
              </>
            )}
          </Button>

          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <span>Overview</span>
          </Link>
          <Link
            href="/dashboard/tools"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <span>User Journeys</span>
          </Link>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by commit message, branch, or SHA..."
            className="w-full bg-white border border-slate-200 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400 transition-colors shadow-2xs"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { key: "All", label: "All Runs" },
            { key: "main", label: "Main Branch" },
            { key: "pr", label: "Pull Requests" },
            { key: "Passed", label: "Passed" },
            { key: "Failed", label: "Failed" },
          ].map((pill) => (
            <button
              key={pill.key}
              onClick={() => setStatusFilter(pill.key as any)}
              className={`px-3 py-1 text-xs rounded-md font-medium whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === pill.key
                  ? "bg-slate-950 text-white shadow-2xs"
                  : "bg-white text-slate-600 hover:text-slate-950 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Test Runs List Container */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            <span>Loading verified test runs from database...</span>
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mx-auto">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">No Test Runs Recorded Yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No verification runs match your current filter. Trigger a manual verification run or push code to your repository to start autonomous QA.
            </p>
            <Button
              onClick={handleTriggerRun}
              disabled={isTriggering}
              className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 shadow-2xs"
            >
              {isTriggering ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 fill-white mr-1" />}
              <span>Trigger First Verification Run</span>
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRuns.map((run) => {
              const isPassed = run.status === "Passed";
              const isFailed = run.status === "Failed";

              return (
                <div
                  key={run.id}
                  className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                >
                  {/* Run Information */}
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {/* Status Pill */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          isPassed
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : isFailed
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-sky-50 text-sky-700 border-sky-200"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isPassed ? "bg-emerald-600" : isFailed ? "bg-rose-600" : "bg-sky-500 animate-pulse"
                          }`}
                        />
                        <span>
                          {isPassed
                            ? `Passed (${run.passedCount})`
                            : isFailed
                            ? `Failed (${run.failedCount} Regressions)`
                            : run.status}
                        </span>
                      </span>

                      {/* Commit Message */}
                      <span className="font-semibold text-xs text-slate-900 truncate max-w-md">
                        {run.commitMsg}
                      </span>

                      {/* Pull Request Badge */}
                      {run.prNumber && (
                        <a
                          href={run.prUrl || `https://github.com/${activeRepo || "HarmanPreet-Singh-XYT/pingroute-web"}/pull/${run.prNumber}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-700 hover:text-slate-950 transition-colors font-semibold"
                        >
                          <GitPullRequest className="h-2.5 w-2.5 text-emerald-600" />
                          <span>PR #{run.prNumber}</span>
                        </a>
                      )}
                    </div>

                    {/* Metadata line */}
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono flex-wrap">
                      <span className="flex items-center gap-1 text-slate-700 font-semibold">
                        <GitBranch className="h-3 w-3 text-slate-600" />
                        {run.branch}
                      </span>
                      <span>·</span>
                      <span className="text-slate-600 font-semibold">{run.hash}</span>
                      <span>·</span>
                      <span className="text-slate-500 font-sans">{run.scope} scope</span>
                      <span>·</span>
                      <span className="text-slate-500 font-sans">{run.testType}</span>
                      <span>·</span>
                      <span>{run.duration}</span>
                      <span>·</span>
                      <span>{run.date} by {run.author}</span>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setSelectedRun(run);
                        setIsForensicsOpen(true);
                      }}
                      className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-2xs cursor-pointer"
                    >
                      <Video className="h-3.5 w-3.5 text-slate-700" />
                      <span>Replay &amp; Forensics</span>
                    </button>

                    {isFailed && (
                      <button
                        onClick={() => {
                          setSelectedRun(run);
                          setIsForensicsOpen(true);
                        }}
                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 text-xs px-3 py-1.5 rounded-md font-semibold shadow-2xs transition-all cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-slate-700" />
                        <span>View Patch</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Forensic Inspection Modal */}
      {isForensicsOpen && selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4 animate-in fade-in-50">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <Video className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-bold text-slate-950">
                  Test Run Forensics: {selectedRun.branch}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border uppercase ${
                    selectedRun.status === "Passed"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  }`}
                >
                  {selectedRun.status}
                </span>
              </div>
              <button
                onClick={() => setIsForensicsOpen(false)}
                className="text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* Video Playback */}
              <div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                  Playwright Browser Session Video Replay
                </span>
                {selectedRun.videoUrl ? (
                  <CustomVideoPlayer
                    src={selectedRun.videoUrl}
                    poster="/placeholder-preview.png"
                    autoPlay={false}
                  />
                ) : (
                  <div className="p-8 border border-dashed border-slate-200 rounded-lg text-center text-slate-400 bg-slate-50">
                    No video artifact captured for this run.
                  </div>
                )}
              </div>

              {/* Console Errors */}
              {selectedRun.consoleErrors && selectedRun.consoleErrors.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Console Errors &amp; Assertion Regressions
                  </span>
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg font-mono text-[11px] text-rose-800 space-y-1 overflow-x-auto">
                    {selectedRun.consoleErrors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-rose-500 select-none">✕</span>
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Fix Synthesizer */}
              {selectedRun.fixProposals && selectedRun.fixProposals.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-slate-700" />
                      Fix Proposal Patch
                    </span>
                    <ApplyFixButton
                      runId={selectedRun.id}
                      status={selectedRun.status === "Passed" ? "passed" : "failed"}
                      fixProposals={selectedRun.fixProposals}
                    />
                  </div>

                  <FixProposalViewer
                    runId={selectedRun.id}
                    branch={selectedRun.branch}
                    proposals={selectedRun.fixProposals}
                  />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs">
              <span className="text-slate-500 font-mono">Run ID: {selectedRun.id}</span>
              <Button
                variant="outline"
                onClick={() => setIsForensicsOpen(false)}
                className="border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs h-7 px-3 font-medium"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
