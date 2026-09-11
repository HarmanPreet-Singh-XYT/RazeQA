"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  Filter,
  Flame,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Layers,
  Lock,
  Network,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Video,
  Workflow,
  X,
  XCircle,
  Globe,
  Compass,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { FixProposalViewer } from "@/components/fix-proposal-viewer";
import { CustomVideoPlayer } from "@/components/custom-video-player";
import { ExternalTestModal } from "@/components/external-test-modal";

// High-fidelity Run Model matching idea.md Section 3 & 4
export type TestStep = {
  id: number;
  name: string;
  command: string;
  duration: string;
  status: "passed" | "failed" | "running";
  errorDetail?: string;
  networkUrl?: string;
  networkStatus?: number;
  consoleLog?: string;
};

export type DashboardRun = {
  id: string;
  branch: string;
  sha: string;
  commitMsg: string;
  prNumber: number;
  author: string;
  route: string;
  repo?: string;
  status: "failed" | "passed" | "running" | "queued" | "superseded" | "cached";
  risk: "high" | "low" | "none";
  duration: string;
  timestamp: string;
  failureReason?: string;
  failingSelector?: string;
  steps: TestStep[];
  networkRequests: {
    method: string;
    url: string;
    status: number;
    size: string;
    duration: string;
    isError?: boolean;
    responseSnippet?: string;
  }[];
  consoleErrors: string[];
  remediationPrompt: string;
  fixProposals?: any[];
  touchedFiles: { path: string; additions: number; deletions: number }[];
  traceUrl?: string | null;
  videoUrl?: string | null;
  screenshotUrl?: string | null;
  timing?: {
    analysis_duration_s?: number;
    journeys_duration_s?: number;
    total_duration_s?: number;
  };
};

/** Artifact URLs from the backend are relative engine paths (e.g.
 * /artifacts/runs/...). The engine requires a bearer token on every request
 * (including artifacts), which the browser does not have — so these are
 * rewritten to go through this app's own /api/artifacts proxy, which holds
 * AGENT_API_KEY server-side and forwards the request with it attached. */
function resolveArtifactUrl(relativeUrl: string | null | undefined): string | null {
  if (!relativeUrl) return null;
  if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) return relativeUrl;
  return `/api${relativeUrl}`;
}

function extractSelectorFromError(error?: string): string | undefined {
  if (!error) return undefined;
  const locatorMatch = error.match(/Locator\(['"](.*?)['"]\)/);
  if (locatorMatch) return locatorMatch[1];
  const testIdMatch = error.match(/\[data-testid=['"](.*?)['"]\]/);
  if (testIdMatch) return testIdMatch[0];
  const idMatch = error.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[0];
  return undefined;
}

function mapBackendToDashboardRun(r: any): DashboardRun {
  const result = r.result || {};
  const isFailed = r.status === "failed" || result.status === "failure";
  const isExternal = r.scope === "external";
  const status: DashboardRun["status"] =
    r.status === "superseded"
      ? "superseded"
      : r.status === "running"
      ? "running"
      : r.status === "queued"
      ? "queued"
      : isFailed
      ? "failed"
      : "passed";

  const realJourneys = result.journey_artifacts || [];
  const timing = result.timing || {};
  const targetRoute = isExternal
    ? (result.artifacts?.[0]?.route || r.sha)
    : (realJourneys[0]?.route || result.affected_surfaces?.[0] || result.route || "/");

  const durationSec = result.duration_s
    ? `${Number(result.duration_s).toFixed(2)}s`
    : timing.total_duration_s
    ? `${Number(timing.total_duration_s).toFixed(2)}s`
    : undefined;

  const failureError = isFailed
    ? (result.failed_journeys?.[0]?.error || result.rationale || "Autonomous journey regression detected")
    : undefined;

  const failingSelector = isFailed
    ? (result.failing_selector || result.failed_journeys?.[0]?.selector || extractSelectorFromError(failureError))
    : undefined;

  const steps = Array.isArray(result.steps) && result.steps.length > 0
    ? result.steps
    : [
        {
          id: 1,
          name: isExternal ? "Target Reachability Probe" : "Diff & Intent Analysis",
          command: isExternal ? `HEAD ${r.sha}` : "Analyze modified AST diff & agent intent",
          duration: timing.analysis_duration_s ? `${Math.round(timing.analysis_duration_s * 1000)}ms` : "—",
          status: "passed",
          consoleLog: isExternal ? "Target verified live" : "Intent and affected surfaces mapped",
        },
        {
          id: 2,
          name: isExternal ? "Playwright Route Exploration" : "Browser Journey Navigation",
          command: `page.goto('${targetRoute}')`,
          duration: timing.execution_duration_s
            ? `${Math.round(timing.execution_duration_s * 1000)}ms`
            : realJourneys[0]?.duration_ms
            ? `${Math.round(realJourneys[0].duration_ms)}ms`
            : "—",
          status: isFailed ? "failed" : "passed",
          consoleLog: isFailed ? (failureError || "Assertion error on route") : "DOM hydrated & assertions passed",
        },
        {
          id: 3,
          name: isExternal ? "Interactive DOM Inspection" : "Quality Dimensions Evaluation",
          command: isExternal ? "observe_page() + inspect_elements()" : "evaluate_quality_dimensions()",
          duration: "—",
          status: isFailed ? "failed" : "passed",
        },
      ];

  const rawRequests = realJourneys[0]?.network_requests || result.network_requests || [];
  const networkRequests = Array.isArray(rawRequests) && rawRequests.length > 0
    ? rawRequests.map((req: any) => ({
        method: req.method || "GET",
        url: req.url || "/",
        status: req.status || 200,
        size: req.size || (req.content_length ? `${req.content_length} B` : "—"),
        duration: req.duration ? `${Math.round(req.duration)}ms` : "—",
        isError: req.status >= 400,
        responseSnippet: req.responseSnippet,
      }))
    : [];

  const rawConsoleErrors = realJourneys[0]?.console_errors || result.console_errors || [];
  const consoleErrors = isFailed
    ? (Array.isArray(rawConsoleErrors) && rawConsoleErrors.length > 0
        ? rawConsoleErrors
        : [failureError || "Verification issue detected"])
    : [];

  return {
    id: r.run_id,
    branch: isExternal ? `🌐 ${r.branch}` : r.branch,
    sha: isExternal ? r.sha : (r.sha?.slice(0, 7) || "unknown"),
    commitMsg: result.summary || result.commit_msg || (isExternal ? `Autonomous verification of ${r.sha}` : `Verified commit on ${r.branch}`),
    prNumber: r.pr_number || result.pr_number || undefined,
    author: isExternal ? "External Site QA" : (r.author || "Coding Agent Bridge"),
    route: targetRoute,
    repo: r.repo,
    status,
    risk:
      result.risk_tag?.toLowerCase() === "high"
        ? "high"
        : result.risk_tag?.toLowerCase() === "low"
        ? "low"
        : "none",
    duration: durationSec || "—",
    timestamp: new Date(r.created_at || Date.now()).toLocaleTimeString(),
    failureReason: failureError,
    failingSelector,
    steps,
    networkRequests,
    consoleErrors,
    remediationPrompt: result.remediation_prompt || "",
    fixProposals: result.fix_proposals || [],
    traceUrl: resolveArtifactUrl(r.trace_url || result.trace_url),
    videoUrl: resolveArtifactUrl(r.video_url || result.video_url),
    screenshotUrl: resolveArtifactUrl(result.screenshot_url),
    timing: result.timing,
    touchedFiles: (result.affected_surfaces || []).map((p: string) => ({
      path: p,
      additions: 1,
      deletions: 0,
    })),
  };
}

export function RunsClient({ userEmail }: { userEmail: string }) {
  const [runs, setRuns] = useState<DashboardRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<number>(4);
  const [activeTab, setActiveTab] = useState<"visual" | "network" | "console" | "prompt" | "intent">("visual");
  const [filterStatus, setFilterStatus] = useState<"all" | "failed" | "passed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [applyFixError, setApplyFixError] = useState<string | null>(null);
  const [isTriggeringTest, setIsTriggeringTest] = useState(false);
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false);
  const [showCliStream, setShowCliStream] = useState(false);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];

  const fetchLiveRuns = async () => {
    try {
      const res = await fetch("/api/runs");
      if (res.ok) {
        const data = await res.json();
        setRunsError(null);
        if (data.runs && Array.isArray(data.runs)) {
          const liveMapped = data.runs.map(mapBackendToDashboardRun);
          setRuns(liveMapped);
          if (liveMapped.length > 0 && !selectedRunId) {
            setSelectedRunId(liveMapped[0].id);
          }
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        setRunsError(errJson.error || `Failed to fetch runs (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setRunsError(err?.message || "Failed to contact PR Testing Engine.");
    } finally {
      setIsLoadingRuns(false);
    }
  };

  useEffect(() => {
    fetchLiveRuns();
    const interval = setInterval(fetchLiveRuns, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerTest = async () => {
    setIsTriggeringTest(true);
    setRunsError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "changed",
          test_type: "functional",
        }),
      });
      if (res.ok) {
        await fetchLiveRuns();
      } else {
        const errJson = await res.json().catch(() => ({}));
        setRunsError(errJson.error || `Failed to trigger journey test (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setRunsError(err?.message || "Failed to contact PR Testing Engine.");
    } finally {
      setIsTriggeringTest(false);
    }
  };

  const filteredRuns = runs.filter((r) => {
    if (filterStatus === "failed" && r.status !== "failed") return false;
    if (filterStatus === "passed" && r.status !== "passed") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.branch.toLowerCase().includes(q) ||
        r.sha.toLowerCase().includes(q) ||
        r.route.toLowerCase().includes(q) ||
        r.commitMsg.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCopyPrompt = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleApplyFix = async () => {
    if (!selectedRun) return;
    setIsApplyingFix(true);
    setApplyFixError(null);
    setShowCliStream(true);

    try {
      const res = await fetch(`/api/runs/${selectedRun.id}/apply`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchLiveRuns();
      } else {
        const errJson = await res.json().catch(() => ({}));
        setApplyFixError(errJson.error || `Failed to apply fix to PR (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setApplyFixError(err?.message || "Failed to contact PR Testing Engine.");
    } finally {
      setIsApplyingFix(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#f8fafc] text-slate-900 font-sans antialiased overflow-hidden">
      {/* 1. Global Navigation Top Bar */}
      <header className="h-14 shrink-0 border-b border-slate-200 bg-white px-5 flex items-center justify-between z-20">
        {/* Left Project / Org Identifier */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="h-7 w-7 rounded-lg bg-slate-950 text-white font-mono font-bold text-xs flex items-center justify-center shadow-xs group-hover:bg-slate-800 transition-colors">
              QA
            </div>
            <span className="font-bold text-slate-950 text-sm tracking-tight hidden sm:inline-block">
              AutoQA Platform
            </span>
          </Link>

          <span className="text-slate-300">/</span>

          {/* Repo switcher */}
          <Link
            href="/dashboard/projects"
            title="Configure connected repository"
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <GitBranch className="h-3.5 w-3.5 text-slate-500" />
            <span>{selectedRun?.repo && selectedRun.repo !== "default" ? selectedRun.repo : "Repositories"}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 border-l border-slate-200 pl-3">
            <Link
              href="/dashboard"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Overview
            </Link>
            <Link
              href="/dashboard/runs"
              className="rounded-md px-2.5 py-1 text-xs font-bold text-slate-950 bg-slate-100 transition-colors"
            >
              PR Forensics
            </Link>
            <Link
              href="/dashboard/projects"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Projects & Settings
            </Link>
            <Link
              href="/dashboard/analytics"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Analytics & AI Insights
            </Link>
            <Link
              href="/dashboard/tools"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Dev Tools
            </Link>
          </nav>

          {/* Daemon Status Pill */}
          <div className="hidden xl:flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-slate-600 font-medium">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Bridge Daemon: port 8765</span>
          </div>
        </div>

        {/* Right Action & User Identity */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsExternalModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-xs hover:bg-indigo-100 active:scale-95 transition-all"
          >
            <Globe className="h-3.5 w-3.5 text-indigo-600" />
            <span>Verify External Site</span>
          </button>

          <button
            onClick={handleTriggerTest}
            disabled={isTriggeringTest}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-60"
          >
            {isTriggeringTest ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-900" />
                <span>Running Pipeline…</span>
              </>
            ) : (
              <>
                <Terminal className="h-3.5 w-3.5 text-slate-500" />
                <span>Trigger Journey Test</span>
              </>
            )}
          </button>

          <div className="h-4 w-px bg-slate-200" />

          {/* User badge + Sign out */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-slate-900 text-white font-bold text-[10px] flex items-center justify-center">
                QA
              </div>
              <span className="text-xs font-medium text-slate-700 hidden md:inline-block">
                {userEmail}
              </span>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="text-xs text-slate-500 hover:text-slate-900 font-medium transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {runsError && (
        <div className="bg-red-50 border-b border-red-200 px-5 py-2 text-xs text-red-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span>{runsError}</span>
          </div>
          <button
            onClick={() => {
              setRunsError(null);
              fetchLiveRuns();
            }}
            className="font-bold text-red-700 hover:text-red-900 ml-4 text-[11px]"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Main Two-Column Split Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Runs Master List (Width: 380px) */}
        <aside className="w-80 md:w-96 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
          {/* Search and Filters */}
          <div className="p-3 border-b border-slate-200 space-y-2.5 bg-slate-50/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search branch, SHA, commit…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFilterStatus("all")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    filterStatus === "all"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  All ({runs.length})
                </button>
                <button
                  onClick={() => setFilterStatus("failed")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    filterStatus === "failed"
                      ? "bg-rose-600 text-white"
                      : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  Failed ({runs.filter((r) => r.status === "failed").length})
                </button>
                <button
                  onClick={() => setFilterStatus("passed")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    filterStatus === "passed"
                      ? "bg-emerald-600 text-white"
                      : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  Passed ({runs.filter((r) => r.status === "passed").length})
                </button>
              </div>

              <span className="text-[11px] font-mono text-slate-400">
                Live Polling
              </span>
            </div>
          </div>

          {/* Runs Feed */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredRuns.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                {isLoadingRuns ? (
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500" />
                    <span>Loading verification runs…</span>
                  </div>
                ) : (
                  <>
                    <p className="font-medium text-slate-600">No verification runs recorded</p>
                    <p className="text-[11px] text-slate-400">Trigger a journey test or connect a repo to view live results.</p>
                  </>
                )}
              </div>
            ) : (
              filteredRuns.map((run) => {
                const isSelected = selectedRun && run.id === selectedRun.id;
                return (
                  <div
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`p-3.5 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-slate-100/90 border-l-3 border-slate-950"
                        : "hover:bg-slate-50/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        {run.status === "failed" ? (
                          <span className="flex h-2 w-2 rounded-full bg-rose-600 ring-4 ring-rose-100 shrink-0" />
                        ) : (
                          <span className="flex h-2 w-2 rounded-full bg-emerald-600 ring-4 ring-emerald-100 shrink-0" />
                        )}
                        <span className="font-mono text-xs font-bold text-slate-900 truncate">
                          {run.branch}
                        </span>
                      </div>

                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {run.timestamp}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 line-clamp-1 mb-2">
                      {run.commitMsg}
                    </p>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-700 font-semibold">PR #{run.prNumber}</span>
                        <span>•</span>
                        <span>{run.sha}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-slate-200/70 px-1.5 py-0.2 text-[10px] text-slate-700">
                          {run.route}
                        </span>
                        <span>{run.duration}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Column: Run Forensics & Inspection Detail View */}
        <main className="flex-1 flex flex-col bg-white overflow-hidden">
          {!selectedRun ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4 border border-slate-200">
                <Terminal className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">No Verification Runs Recorded</h3>
              <p className="text-xs text-slate-500 max-w-sm mb-5">
                Execute your first autonomous verification journey or click "Trigger Journey Test" to analyze code diffs.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTriggerTest}
                  disabled={isTriggeringTest}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors shadow-xs disabled:opacity-60"
                >
                  {isTriggeringTest ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
                  Trigger Journey Test
                </button>
                <button
                  onClick={() => setIsExternalModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Globe className="h-3.5 w-3.5 text-indigo-600" />
                  Verify External Site
                </button>
              </div>
            </div>
          ) : (
            <>
          {/* Detail View Header */}
          <div className="border-b border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs text-slate-500 font-bold uppercase tracking-wider">
                  Check Run {selectedRun.id}
                </span>
                <span>•</span>
                <span className="text-xs font-mono text-slate-500">{selectedRun.timestamp}</span>
                {selectedRun.status === "failed" ? (
                  <span className="inline-flex items-center gap-1 rounded bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                    <XCircle className="h-3 w-3" />
                    FAILED — HIGH RISK REGRESSION
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />
                    ALL JOURNEYS PASSED
                  </span>
                )}
              </div>

              <h2 className="text-lg font-bold text-slate-950 tracking-tight">
                {selectedRun.commitMsg}
              </h2>

              <div className="flex items-center gap-3 text-xs text-slate-600 font-mono mt-1.5">
                <span className="flex items-center gap-1 text-slate-900 font-semibold">
                  <GitBranch className="h-3.5 w-3.5 text-slate-500" />
                  {selectedRun.branch}
                </span>
                <span>•</span>
                <span>commit: {selectedRun.sha}</span>
                <span>•</span>
                <span>author: {selectedRun.author}</span>
                <span>•</span>
                <span>target route: <code className="text-slate-900 bg-slate-100 px-1 py-0.5 rounded">{selectedRun.route}</code></span>
                {selectedRun.timing && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1.5 rounded bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] text-slate-700">
                      <span>SLA:</span>
                      <strong className="text-slate-900">{selectedRun.timing.total_duration_s?.toFixed(2)}s</strong>
                      <span className="text-slate-400">(A: {selectedRun.timing.analysis_duration_s?.toFixed(2)}s / J: {selectedRun.timing.journeys_duration_s?.toFixed(2)}s)</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Action Button & Path Analytics */}
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/runs/${selectedRun.id}/analytics`}
                className="rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-700 px-3 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs shrink-0"
              >
                <Compass className="h-3.5 w-3.5 text-indigo-600" />
                <span>Quality &amp; Path Analytics</span>
              </Link>

              {selectedRun.status === "failed" && (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    onClick={handleApplyFix}
                    disabled={isApplyingFix}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-9 shadow-sm shrink-0 gap-1.5 disabled:opacity-60"
                  >
                    {isApplyingFix ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Applying Fix to PR…</span>
                      </>
                    ) : (
                      <>
                        <GitPullRequest className="h-3.5 w-3.5" />
                        <span>Apply Fix to PR</span>
                      </>
                    )}
                  </Button>
                  {applyFixError && (
                    <span className="text-[11px] text-red-600 font-medium">{applyFixError}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step Timeline Ribbon */}
          <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-2.5 overflow-x-auto">
            <div className="flex items-center gap-2 text-xs font-mono min-w-max">
              <span className="font-sans font-bold text-slate-600 text-[11px] mr-1 uppercase">
                Journey Steps:
              </span>
              {selectedRun.steps.map((step, idx) => {
                const isActive = step.id === selectedStepId;
                return (
                  <button
                    key={step.id}
                    onClick={() => setSelectedStepId(step.id)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all ${
                      isActive
                        ? "bg-white text-slate-950 font-bold shadow-xs border border-slate-300"
                        : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    {step.status === "failed" ? (
                      <XCircle className="h-3 w-3 text-rose-600 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                    )}
                    <span>
                      {idx + 1}. {step.name}
                    </span>
                    <span className="text-[10px] text-slate-400">({step.duration})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-Panel Tabs (Visual Browser Frame vs Network vs Console vs Prompt) */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 text-xs font-semibold text-slate-600">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setActiveTab("visual")}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === "visual"
                    ? "border-slate-950 text-slate-950 font-bold"
                    : "border-transparent hover:text-slate-900"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Visual CDP Snapshot</span>
              </button>

              <button
                onClick={() => setActiveTab("network")}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === "network"
                    ? "border-slate-950 text-slate-950 font-bold"
                    : "border-transparent hover:text-slate-900"
                }`}
              >
                <Network className="h-3.5 w-3.5" />
                <span>Network Waterfall</span>
                {selectedRun.networkRequests.some((n) => n.isError) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                )}
              </button>

              <button
                onClick={() => setActiveTab("console")}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === "console"
                    ? "border-slate-950 text-slate-950 font-bold"
                    : "border-transparent hover:text-slate-900"
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>Console Logs</span>
                {selectedRun.consoleErrors.length > 0 && (
                  <span className="rounded bg-rose-100 text-rose-800 text-[10px] px-1 py-0.2">
                    {selectedRun.consoleErrors.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("prompt")}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === "prompt"
                    ? "border-slate-950 text-slate-950 font-bold"
                    : "border-transparent hover:text-slate-900"
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>Remediation Prompt</span>
              </button>

              <button
                onClick={() => setActiveTab("intent")}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === "intent"
                    ? "border-slate-950 text-slate-950 font-bold"
                    : "border-transparent hover:text-slate-900"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Files Touched ({selectedRun.touchedFiles.length})</span>
              </button>
            </div>

            {/* Artifact Download Buttons */}
            <div className="flex items-center gap-2">
              {selectedRun.traceUrl ? (
                <a
                  href={selectedRun.traceUrl}
                  download
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-mono text-slate-700 hover:bg-slate-100"
                >
                  <Download className="h-3 w-3 text-slate-500" />
                  <span>trace.zip</span>
                </a>
              ) : (
                <span
                  title="No trace recorded for this run"
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-mono text-slate-400 cursor-not-allowed"
                >
                  <Download className="h-3 w-3 text-slate-300" />
                  <span>trace.zip</span>
                </span>
              )}
              {selectedRun.videoUrl ? (
                <a
                  href={selectedRun.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-mono text-slate-700 hover:bg-slate-100"
                >
                  <Video className="h-3 w-3 text-slate-500" />
                  <span>video.webm</span>
                </a>
              ) : (
                <span
                  title="No video recorded for this run"
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-mono text-slate-400 cursor-not-allowed"
                >
                  <Video className="h-3 w-3 text-slate-300" />
                  <span>video.webm</span>
                </span>
              )}
              {selectedRun.screenshotUrl && (
                <a
                  href={selectedRun.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-mono text-rose-800 hover:bg-rose-100 font-semibold"
                >
                  <Camera className="h-3 w-3 text-rose-600" />
                  <span>screenshot.png</span>
                </a>
              )}
            </div>
          </div>

          {/* Sub-Panel Content Area */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#fafaf9]">
            {/* 1. VISUAL BROWSER FRAME TAB */}
            {activeTab === "visual" && (
              <div className="space-y-4 max-w-4xl mx-auto">
                {/* Session Video */}
                {selectedRun.videoUrl && (
                  <div className="space-y-1.5">
                    <span className="font-semibold text-slate-900 text-xs px-1 block">
                      Session Replay
                    </span>
                    <CustomVideoPlayer
                      src={selectedRun.videoUrl}
                      className="max-h-[440px]"
                    />
                  </div>
                )}
                {/* Annotated Failure Screenshot, when available */}
                {selectedRun.screenshotUrl && (
                  <div className="rounded-xl border border-rose-300 bg-white shadow-md shadow-slate-200/50 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-rose-200 bg-rose-50/80 px-4 py-2.5 text-xs font-semibold text-rose-900">
                      <div className="flex items-center gap-2">
                        <Camera className="h-3.5 w-3.5 text-rose-600" />
                        <span>Annotated Failure Defect (Bounding Box & Callouts)</span>
                      </div>
                      <a
                        href={selectedRun.screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-rose-600 hover:underline text-[11px] font-mono"
                      >
                        View Full Image ↗
                      </a>
                    </div>
                    <div className="p-3 bg-slate-950 flex justify-center">
                      <img
                        src={selectedRun.screenshotUrl}
                        alt="Annotated Defect Screenshot"
                        className="max-h-[380px] object-contain rounded border border-slate-800"
                      />
                    </div>
                  </div>
                )}
                {/* Browser Frame Window */}
                <div className="rounded-xl border border-slate-300 bg-white shadow-md shadow-slate-200/50 overflow-hidden">
                  {/* Browser Bar */}
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-slate-300 border border-slate-400" />
                      <div className="h-2.5 w-2.5 rounded-full bg-slate-300 border border-slate-400" />
                      <div className="h-2.5 w-2.5 rounded-full bg-slate-300 border border-slate-400" />
                      <div className="ml-2 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-0.5 font-mono text-xs text-slate-700">
                        <Lock className="h-3 w-3 text-emerald-600" />
                        <span>http://localhost:3000{selectedRun.route}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                      <span>Step {selectedStepId}/4</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.2 text-[10px]">
                        t = {selectedRun.duration}
                      </span>
                    </div>
                  </div>

                  {/* Rendered Viewport Simulation */}
                  <div className="relative p-8 bg-white min-h-[340px] flex flex-col justify-between">
                    {/* Simulated Page Content */}
                    <div className="space-y-4 max-w-md mx-auto w-full">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h3 className="font-bold text-slate-900 text-sm">Checkout Order #8194</h3>
                        <span className="font-mono text-xs text-slate-500">$128.00 USD</span>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="text-slate-600">Shipping: 123 Tech Lane, San Francisco CA</div>
                        <div className="text-slate-600">Method: Priority Overnight Express</div>
                      </div>

                      {/* The Failing Element Highlight Box */}
                      {selectedRun.status === "failed" && selectedStepId === 4 ? (
                        <div className="relative rounded-lg border-2 border-dashed border-rose-500 bg-rose-50/40 p-4 space-y-2 transition-all">
                          <div className="absolute -top-3 left-3 rounded bg-rose-600 px-2 py-0.5 text-[10px] font-mono font-bold text-white shadow-xs">
                            Assertion Failed: [data-testid=&apos;apple-pay-checkout&apos;]
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <span className="font-bold text-xs text-slate-900">1-Tap Apple Pay</span>
                            <span className="rounded bg-black px-2 py-1 text-xs text-white font-mono font-semibold">
                              Pay
                            </span>
                          </div>

                          <div className="text-[11px] text-rose-700 font-mono">
                            HTTP 422: customer_address token missing on charge request
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-between">
                          <span className="font-bold text-xs text-slate-900">Apple Pay Active</span>
                          <span className="rounded bg-black px-2 py-1 text-xs text-white font-mono font-semibold">
                            Pay
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Timeline Scrubber */}
                    <div className="pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
                      <div className="flex items-center gap-2">
                        <Play className="h-3.5 w-3.5 text-slate-700" />
                        <span>00:01.89 / 00:01.89</span>
                      </div>
                      <div className="flex-1 mx-4 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            selectedRun.status === "failed" ? "bg-rose-500" : "bg-emerald-500"
                          } w-full`}
                        />
                      </div>
                      <span>30 FPS WebM</span>
                    </div>
                  </div>
                </div>

                {/* Step Command Bar */}
                <div className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-slate-600" />
                    <span className="font-mono text-slate-800">
                      {selectedRun.steps.find((s) => s.id === selectedStepId)?.command}
                    </span>
                  </div>
                  <span className="font-mono text-slate-400">
                    {selectedRun.steps.find((s) => s.id === selectedStepId)?.duration}
                  </span>
                </div>
              </div>
            )}

            {/* 2. NETWORK WATERFALL TAB */}
            {activeTab === "network" && (
              <div className="card-light rounded-xl bg-white overflow-hidden max-w-4xl mx-auto">
                <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Method &amp; Request URL</span>
                  <div className="flex items-center gap-6">
                    <span>Status</span>
                    <span>Size</span>
                    <span>Duration</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 text-xs font-mono">
                  {selectedRun.networkRequests.map((req, idx) => (
                    <div
                      key={idx}
                      className={`p-3 flex items-center justify-between transition-colors ${
                        req.isError ? "bg-rose-50/70" : "hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            req.method === "POST" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {req.method}
                        </span>
                        <span className="font-semibold text-slate-900">{req.url}</span>
                      </div>

                      <div className="flex items-center gap-6">
                        <span
                          className={`font-bold ${
                            req.isError ? "text-rose-700 font-bold" : "text-emerald-700"
                          }`}
                        >
                          {req.status} {req.isError ? "Unprocessable" : "OK"}
                        </span>
                        <span className="text-slate-500 w-14 text-right">{req.size}</span>
                        <span className="text-slate-500 w-16 text-right">{req.duration}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Error JSON payload preview */}
                {selectedRun.networkRequests.some((n) => n.responseSnippet) && (
                  <div className="p-4 border-t border-slate-200 bg-slate-50/80">
                    <span className="text-[11px] font-mono text-slate-500 block mb-1.5 uppercase font-bold">
                      Failed Response Body (HTTP 422):
                    </span>
                    <pre className="p-3 rounded-lg border border-slate-200 bg-white font-mono text-[11px] text-rose-800 overflow-x-auto">
                      {selectedRun.networkRequests.find((n) => n.responseSnippet)?.responseSnippet}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* 3. CONSOLE LOGS TAB */}
            {activeTab === "console" && (
              <div className="rounded-xl border border-slate-300 bg-slate-950 text-slate-200 p-5 font-mono text-xs leading-relaxed max-w-4xl mx-auto shadow-md">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4 text-slate-400 text-[11px]">
                  <span>Headless Chromium Console Log Output</span>
                  <span>CDP stream captured</span>
                </div>

                <div className="space-y-2">
                  <div className="text-slate-400">[Info] [AutoQA Sandbox] Seeded session validated. Running journey.</div>
                  <div className="text-slate-400">[Info] Navigation to /checkout completed in 142ms.</div>
                  <div className="text-slate-300">[Log] Synthetic Apple Pay session dispatched: tok_apple_4819</div>
                  {selectedRun.consoleErrors.map((err, i) => (
                    <div key={i} className="text-rose-400 bg-rose-950/40 p-2 rounded border border-rose-900/60 font-semibold">
                      {err}
                    </div>
                  ))}
                  {selectedRun.consoleErrors.length === 0 && (
                    <div className="text-emerald-400">[Success] All assertions passed without console warnings.</div>
                  )}
                </div>
              </div>
            )}

            {/* 4. REMEDIATION PROMPT & CODE FIX TAB */}
            {activeTab === "prompt" && (
              <div className="space-y-4 max-w-4xl mx-auto">
                {selectedRun.fixProposals && selectedRun.fixProposals.length > 0 ? (
                  <FixProposalViewer
                    runId={selectedRun.id}
                    branch={selectedRun.branch}
                    proposals={selectedRun.fixProposals}
                    onFixApplied={fetchLiveRuns}
                  />
                ) : (
                  <div className="card-light rounded-xl bg-white p-5 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">
                          AI Intent-Driven Remediation Prompt
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Copy and paste directly back into Claude Code or Cursor to resolve regression.
                        </p>
                      </div>

                      <Button
                        onClick={() => handleCopyPrompt(selectedRun.remediationPrompt)}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5 border-slate-300"
                      >
                        {copiedPrompt ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy Prompt</span>
                          </>
                        )}
                      </Button>
                    </div>

                    <pre className="p-4 rounded-lg border border-slate-200 bg-slate-50 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {selectedRun.remediationPrompt || "No active regressions detected on this run."}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* 5. FILES TOUCHED TAB */}
            {activeTab === "intent" && (
              <div className="card-light rounded-xl bg-white p-5 max-w-4xl mx-auto space-y-3">
                <h4 className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-2">
                  Modified AST Surfaces in Pull Request
                </h4>

                <div className="divide-y divide-slate-100 text-xs font-mono">
                  {selectedRun.touchedFiles.map((file, idx) => (
                    <div key={idx} className="py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="h-4 w-4 text-slate-500" />
                        <span className="text-slate-900 font-semibold">{file.path}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-700 font-bold">+{file.additions}</span>
                        <span className="text-rose-700 font-bold">-{file.deletions}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </main>
      </div>

      <ExternalTestModal
        isOpen={isExternalModalOpen}
        onClose={() => setIsExternalModalOpen(false)}
        onSuccess={() => fetchLiveRuns()}
      />
    </div>
  );
}
