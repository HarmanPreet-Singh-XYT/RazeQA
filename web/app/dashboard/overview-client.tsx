"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Compass,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Layers,
  Lock,
  Network,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  User,
  Video,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import { FixProposalViewer } from "@/components/fix-proposal-viewer";
import { CustomVideoPlayer } from "@/components/custom-video-player";
import { ExternalTestModal } from "@/components/external-test-modal";
import { useDashboard } from "@/components/dashboard-context";

// --- Domain Models based on Real AutoQA Backend ---

export type RunRecord = {
  id: string;
  branch: string;
  sha: string;
  prNumber?: number;
  prUrl?: string;
  triggeringUser: string;
  triggerType: "on-demand" | "on-push" | "on-PR";
  status: "queued" | "running" | "passed" | "failed" | "flaky" | "superseded" | "cached";
  duration: string;
  timestamp: string;
  risk: "Low" | "Medium" | "High";
  riskRationale: string;
  scope: "changed" | "full";
  testType: string;
  bucketCounts: {
    passed: number;
    failed: number;
    additionalFindings: number;
  };
  additionalFindingsDetails?: string[];
  baselineComparison: {
    isNewRegression: boolean;
    mainSha: string;
    details: string;
  };
  artifacts: {
    traceUrl: string | null;
    videoUrl: string | null;
    screenshotUrl?: string | null;
    domSnapshotAvailable: boolean;
    networkWaterfallCount: number;
  };
  timing?: {
    analysis_duration_s?: number;
    journeys_duration_s?: number;
    total_duration_s?: number;
  };
  remediationPrompt?: string;
  fixProposals?: any[];
};

export type IntentLog = {
  id: string;
  branch: string;
  user: string;
  time: string;
  fileModified: string;
  prompt: string;
  inferredIntent: string;
  status: "in-flight" | "verified";
};

function resolveArtifactUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `/api/artifacts?file=${encodeURIComponent(url)}`;
}

function mapBackendRunToDashboardRun(r: any, repoName?: string | null): RunRecord {
  const result = r.result || {};
  const isFailed = r.status === "failed" || result.status === "failure";
  const isExternal = r.scope === "external";
  const status: RunRecord["status"] =
    r.status === "superseded"
      ? "superseded"
      : r.status === "running"
      ? "running"
      : r.status === "queued"
      ? "queued"
      : r.status === "cached"
      ? "cached"
      : isFailed
      ? "failed"
      : "passed";
  const passedCount = result.passed_journeys?.length ?? (status === "passed" ? 1 : 0);
  const failedCount = result.failed_journeys?.length ?? (status === "failed" ? 1 : 0);
  const isNewRegression = Boolean(result.baseline_comparison?.has_new_regressions);

  const durationSec = result.duration_s
    ? `${Number(result.duration_s).toFixed(1)}s`
    : result.timing?.total_duration_s
    ? `${Number(result.timing.total_duration_s).toFixed(1)}s`
    : r.duration || "0s";

  const repoSlug = r.repo && r.repo !== "default" ? r.repo : repoName;
  const prUrl = isExternal
    ? r.sha
    : r.pr_url ||
      result.pr_url ||
      (r.pr_number && repoSlug ? `https://github.com/${repoSlug}/pull/${r.pr_number}` : undefined);

  return {
    id: r.run_id || r.id || `run-${Date.now()}`,
    branch: isExternal ? `🌐 ${r.branch}` : r.branch || "main",
    sha: isExternal ? r.sha : r.sha?.slice(0, 7) || "HEAD",
    prNumber: r.pr_number || result.pr_number || (r.prNumber ? parseInt(r.prNumber, 10) : undefined),
    prUrl,
    triggeringUser: isExternal ? "External Site Tester" : r.author || r.triggeringUser || "Autonomous QA",
    triggerType: (r.triggerType as any) || "on-demand",
    status,
    duration: durationSec,
    timestamp: r.created_at ? new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now",
    risk: (result.risk_tag as any) || (isExternal ? "Low" : isFailed ? "High" : "Low"),
    riskRationale:
      result.summary ||
      result.rationale ||
      r.riskRationale ||
      (isFailed
        ? "Verification regression detected on preview sandbox."
        : "Synthetic user journeys verified green against preview sandbox."),
    scope: (r.scope as any) || "changed",
    testType: (r.test_type as any) || (r.testType as any) || "functional",
    bucketCounts: {
      passed: passedCount,
      failed: failedCount,
      additionalFindings: result.additional_findings?.length ?? 0,
    },
    additionalFindingsDetails: result.additional_findings || r.additionalFindingsDetails || [],
    baselineComparison: {
      isNewRegression,
      mainSha: result.baseline_comparison?.main_sha || "main",
      details: isNewRegression
        ? "New regression introduced on this branch."
        : "Matches baseline behavior on main.",
    },
    artifacts: {
      traceUrl: resolveArtifactUrl(r.trace_url || result.trace_url || r.artifacts?.traceUrl) || null,
      videoUrl: resolveArtifactUrl(r.video_url || result.video_url || r.artifacts?.videoUrl) || null,
      screenshotUrl: resolveArtifactUrl(result.screenshot_url || r.artifacts?.screenshotUrl) || null,
      domSnapshotAvailable: !!(r.artifacts?.domSnapshotAvailable || result.dom_snapshot_url),
      networkWaterfallCount: result.journey_artifacts?.[0]?.network_requests?.length || 0,
    },
    timing: result.timing || undefined,
    remediationPrompt: result.remediation_prompt || r.remediationPrompt,
    fixProposals: result.fix_proposals || r.fixProposals || [],
  };
}

export function OverviewClient({ userEmail }: { userEmail?: string } = {}) {
  const { activeRepo, setActiveRepo } = useDashboard();

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [intents, setIntents] = useState<IntentLog[]>([]);
  const [gitInfo, setGitInfo] = useState<{ sha?: string; branch?: string }>({});
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false);
  const [engineConnected, setEngineConnected] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const activeRepoName = activeRepo || projects[0]?.repo_full_name || "HarmanPreet-Singh-XYT/pingroute-web";
  const activeProject = projects.find((p) => p.repo_full_name === activeRepoName) || projects[0] || null;

  // Real backend polling
  const fetchLiveRuns = async () => {
    setIsRefreshing(true);
    try {
      const repoQuery = activeRepoName ? `?repo=${encodeURIComponent(activeRepoName)}` : "";
      const res = await fetch(`/api/runs${repoQuery}`);
      if (res.ok) {
        const data = await res.json();
        setRunsError(null);
        if (data.git) {
          setGitInfo(data.git);
        }
        if (data.runs && Array.isArray(data.runs)) {
          const liveMapped = data.runs.map((r: any) => mapBackendRunToDashboardRun(r, activeRepoName));
          setRuns(liveMapped);
          if (liveMapped.length > 0 && (!selectedRunId || !liveMapped.some((r: RunRecord) => r.id === selectedRunId))) {
            setSelectedRunId(liveMapped[0].id);
          }
        }
        setEngineConnected(data.engineConnected !== undefined ? Boolean(data.engineConnected) : true);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setRunsError(errJson.error || `Failed to fetch runs (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setRunsError(err?.message || "Could not reach AutoQA server.");
    } finally {
      setIsRefreshing(false);
      setIsLoadingRuns(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        if (data.projects && Array.isArray(data.projects)) {
          setProjects(data.projects);
          if (!activeRepo && data.projects.length > 0) {
            setActiveRepo(data.projects[0].repo_full_name);
          }
        }
      }
    } catch {}
  };

  const fetchIntents = async () => {
    try {
      const targetBranch = gitInfo.branch || runs[0]?.branch || "main";
      const res = await fetch(`/api/intents?branch=${encodeURIComponent(targetBranch)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.intents && Array.isArray(data.intents)) {
          const mapped = data.intents.map((e: any, idx: number) => ({
            id: e.id || `int_${idx}`,
            branch: e.branch || targetBranch,
            user: e.user || e.repo || "agent",
            time: e.timestamp
              ? new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "Recent",
            fileModified: Array.isArray(e.files) ? e.files.join(", ") : e.files || "N/A",
            prompt: e.prompt_summary || e.prompt || "Code modification",
            inferredIntent: e.reasoning || e.inferredIntent || "Automated test verification",
            status: "in-flight" as const,
          }));
          setIntents(mapped);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchLiveRuns();
    fetchProjects();
    fetchIntents();
    const interval = setInterval(() => {
      fetchLiveRuns();
      fetchIntents();
    }, 4000);
    return () => clearInterval(interval);
  }, [activeRepoName]);

  const handleCopyPrompt = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  // Real pipeline dispatch
  const handleTriggerAudit = async () => {
    setIsAuditing(true);
    setAuditError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: activeRepoName,
          branch: runs[0]?.branch || gitInfo.branch || "main",
          scope: "changed",
          test_type: "functional",
        }),
      });
      if (res.ok) {
        await fetchLiveRuns();
      } else {
        const errJson = await res.json().catch(() => ({}));
        setAuditError(errJson.error || `Failed to trigger audit (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setAuditError(err?.message || "Failed to contact PR Testing Engine.");
    } finally {
      setIsAuditing(false);
    }
  };

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  const totalRuns = runs.length;
  const passedRuns = runs.filter((r) => r.status === "passed").length;
  const passRate = totalRuns > 0 ? ((passedRuns / totalRuns) * 100).toFixed(1) : "--";

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full animate-in fade-in-50 duration-200">
      {/* Project Navigation & Context Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-950 transition-colors bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-2xs hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>All Projects</span>
          </Link>
          <span className="text-slate-300">/</span>
          <div className="flex items-center gap-2">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
              activeRepoName.startsWith("external:")
                ? "bg-sky-50 border border-sky-200 text-sky-600"
                : "bg-slate-100 border border-slate-200 text-slate-700"
            }`}>
              {activeRepoName.startsWith("external:") ? (
                <Globe className="h-4 w-4" />
              ) : (
                <GitBranch className="h-4 w-4" />
              )}
            </div>
            <h1 className="text-sm font-bold text-slate-900">
              {activeRepoName.startsWith("external:")
                ? activeRepoName.replace("external:", "")
                : (activeProject?.name || activeRepoName.split("/")[1] || activeRepoName)}
            </h1>
            {activeRepoName.startsWith("external:") && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                External Site
              </span>
            )}
          </div>
          {activeProject?.domain && (
            <a
              href={activeProject.domain.startsWith("http") ? activeProject.domain : `https://${activeProject.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 font-mono bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded transition-colors"
            >
              <span>{activeProject.domain}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {activeRepoName.startsWith("external:") ? (
            <a
              href={activeProject?.domain || `https://${activeRepoName.replace("external:", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <Globe className="h-3.5 w-3.5 text-sky-600" />
              <span className="font-mono text-[11px] truncate max-w-[200px]">
                {activeProject?.domain || activeRepoName.replace("external:", "")}
              </span>
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </a>
          ) : (
            <a
              href={`https://github.com/${activeRepoName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <GitBranch className="h-3.5 w-3.5 text-slate-500" />
              <span className="font-mono text-[11px] truncate max-w-[180px]">{activeRepoName}</span>
            </a>
          )}
          <Link
            href="/dashboard/projects"
            className="flex items-center gap-1 text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <span>Settings</span>
          </Link>
        </div>
      </div>

      {/* =========================================================================
          TIER 1: SYSTEM HEALTH & VERIFICATION SIGNALS
          ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600" />
              AutoQA Platform Health
            </span>
            <span className="rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-mono font-semibold text-slate-900">
              {activeRepoName}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExternalModalOpen(true)}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-md transition-colors shadow-2xs"
            >
              <Globe className="h-3.5 w-3.5 text-sky-600" />
              <span>Verify External URL</span>
            </button>

            <Button
              onClick={handleTriggerAudit}
              disabled={isAuditing}
              className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {isAuditing ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Executing Pipeline...</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-white" />
                  <span>Trigger Verification</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 4 Signals Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          {/* Signal 1: Engine Status */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">Testing Engine</span>
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <span
                className={`h-2 w-2 rounded-full ${
                  engineConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                }`}
              />
              <span>{engineConnected ? "Connected (Ready)" : "Engine Offline"}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              Playwright headless Chromium sandbox
            </span>
          </div>

          {/* Signal 2: Pass Rate */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">Aggregate Pass Rate</span>
            <div className="text-slate-900 font-bold text-sm">
              {totalRuns > 0 ? `${passRate}% (${passedRuns}/${totalRuns})` : "Awaiting runs"}
            </div>
            <span className="text-[10px] text-emerald-600 font-sans font-medium">
              {totalRuns > 0 ? "Live verified commits" : "No tests executed yet"}
            </span>
          </div>

          {/* Signal 3: Resource & Token Savings */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">Deterministic Caching</span>
            <div className="text-slate-900 font-bold text-sm font-mono">
              {totalRuns > 0 ? `~${(totalRuns * 15000).toLocaleString()} tokens` : "0 tokens"}
            </div>
            <span className="text-[10px] text-slate-500 font-sans">Saved via commit SHA deduplication</span>
          </div>

          {/* Signal 4: GitHub App Connection */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">GitHub App Webhook</span>
            <div className="flex items-center gap-1.5 text-slate-900 font-bold">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Check Runs Active</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              Installation #{activeProject?.installation_id || "Active"}
            </span>
          </div>
        </div>
      </div>

      {/* Errors strip if any */}
      {auditError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{auditError}</span>
          </div>
          <button onClick={() => setAuditError(null)} className="text-slate-500 hover:text-slate-900 font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* =========================================================================
          TIER 2: REPOSITORY CONFIGURATION & COVERAGE
          ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-500">
              Repository Configuration &amp; Coverage
            </span>
            <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-800 font-semibold">
              {activeRepoName}
            </span>
          </div>

          {runs.length > 0 ? (
            <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-mono font-bold">
              HEAD: {runs[0].status.toUpperCase()} ({runs[0].sha.slice(0, 7)})
            </span>
          ) : (
            <span className="rounded bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 text-[10px] font-mono">
              Awaiting First Run
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1">
            <span className="text-[10px] text-slate-500 block font-medium">Sandbox Defaults:</span>
            <div className="font-mono text-slate-900 font-medium">
              scope: <span className="text-slate-900 font-bold">{activeProject?.settings?.scope || "changed"}</span> • type:{" "}
              <span className="text-slate-900 font-bold">{activeProject?.settings?.test_type || "functional"}</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1">
            <span className="text-[10px] text-slate-500 block font-medium">Recorded Verifications:</span>
            <div className="font-mono text-slate-900 font-bold">
              {runs.length > 0 ? `${runs.length} Runs Recorded` : "0 Runs Recorded"}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1">
            <span className="text-[10px] text-slate-500 block font-medium">Test Personas:</span>
            <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Configured (User &amp; Admin)</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1">
            <span className="text-[10px] text-slate-500 block font-medium">Active Branch:</span>
            <div className="font-mono text-slate-900 truncate font-semibold">
              {runs[0]?.branch || gitInfo.branch || "main"}
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          TIER 3: MASTER-DETAIL PER-RUN PIPELINE INSPECTOR
          ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-700" />
              Per-Run Verification Pipeline &amp; Forensics
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select any verified branch run on the left to inspect its video replay, traces, and AI patches.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono">
              {runs.length} {runs.length === 1 ? "run" : "runs"} captured
            </span>
          </div>
        </div>

        {runs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mx-auto">
              <Play className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-950">No Verification Runs Recorded</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {isLoadingRuns
                ? "Connecting to AutoQA Engine..."
                : "Trigger a verification run to explore user journeys and generate forensics."}
            </p>
            <Button
              onClick={handleTriggerAudit}
              disabled={isAuditing}
              className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 shadow-2xs"
            >
              {isAuditing ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 fill-white mr-1" />}
              <span>Trigger First Verification Run</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left Column: Runs List Selector (4 cols) */}
            <div className="lg:col-span-4 divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
              {runs.map((run) => {
                const isSelected = selectedRun && run.id === selectedRun.id;
                const isPassed = run.status === "passed";
                const isFailed = run.status === "failed";

                return (
                  <div
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected ? "bg-slate-100/90 border-l-3 border-slate-950 font-medium" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-semibold text-slate-900 truncate max-w-[200px] flex items-center gap-1.5">
                        <GitBranch className="h-3 w-3 text-slate-600 shrink-0" />
                        {run.branch}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{run.timestamp}</span>
                    </div>

                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold border font-mono uppercase tracking-wide ${
                          isPassed
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : isFailed
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-sky-50 text-sky-700 border-sky-200"
                        }`}
                      >
                        {run.status.toUpperCase()}
                      </span>

                      <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[10px] font-mono text-slate-600 font-medium">
                        {run.triggerType}
                      </span>

                      <span className="text-[11px] font-mono text-slate-500">{run.duration}</span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono flex items-center justify-between">
                      <span className="truncate max-w-[180px]">
                        {run.sha} • {run.triggeringUser}
                      </span>
                      {run.prNumber && (
                        <span className="text-slate-900 font-semibold text-[10px]">PR #{run.prNumber}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right Column: Selected Run Detail Forensics (8 cols) */}
            {selectedRun && (
              <div className="lg:col-span-8 p-5 space-y-5 bg-white">
                {/* Header Overview */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-xs font-bold text-slate-950">{selectedRun.id}</span>
                      <span className="text-slate-300">•</span>
                      <span className="font-mono text-xs text-slate-500">{selectedRun.sha}</span>
                      {selectedRun.prNumber && (
                        <a
                          href={selectedRun.prUrl || `https://github.com/${activeRepoName}/pull/${selectedRun.prNumber}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[10px] font-mono font-semibold text-emerald-700 hover:border-emerald-300 flex items-center gap-1"
                        >
                          <GitPullRequest className="h-2.5 w-2.5" />
                          <span>PR #{selectedRun.prNumber}</span>
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      Trigger: <span className="text-slate-900 font-semibold">{selectedRun.triggerType}</span> by{" "}
                      <span className="text-slate-900 font-semibold">{selectedRun.triggeringUser}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-600">
                      Scope: {selectedRun.scope}
                    </span>
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-600">
                      Type: {selectedRun.testType}
                    </span>
                    <Link
                      href={`/dashboard/runs/${selectedRun.id}/analytics`}
                      className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 px-2.5 py-0.5 text-xs font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                    >
                      <Compass className="h-3 w-3 text-slate-600" />
                      <span>Path &amp; Quality Analytics</span>
                    </Link>
                  </div>
                </div>

                {/* Risk Tag & Diff/Intent Rationale */}
                <div
                  className={`rounded-lg border p-3 text-xs space-y-1 ${
                    selectedRun.risk === "High"
                      ? "border-rose-200 bg-rose-50 text-rose-900"
                      : "border-slate-200 bg-slate-50 text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase font-mono ${
                        selectedRun.risk === "High"
                          ? "bg-rose-600 text-white"
                          : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      }`}
                    >
                      Risk: {selectedRun.risk}
                    </span>
                    <span className="font-bold text-slate-900">Diff &amp; Intent Analyzer:</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">{selectedRun.riskRationale}</p>
                </div>

                {/* Bucket Counts & Baseline Comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Bucket Counts */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                    <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider block">
                      Verification Bucket Counts
                    </span>
                    <div className="flex items-center gap-3 font-mono">
                      <span className="text-emerald-700 font-bold">✓ {selectedRun.bucketCounts.passed} Passed</span>
                      {selectedRun.bucketCounts.failed > 0 && (
                        <span className="text-rose-700 font-bold">✗ {selectedRun.bucketCounts.failed} Failed</span>
                      )}
                      <span className="text-slate-600">ℹ {selectedRun.bucketCounts.additionalFindings} Findings</span>
                    </div>
                    {selectedRun.additionalFindingsDetails && selectedRun.additionalFindingsDetails.length > 0 && (
                      <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
                        {selectedRun.additionalFindingsDetails.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Baseline Comparison */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                    <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider block">
                      Baseline Comparison (vs main)
                    </span>
                    <div className="flex items-center gap-1.5 font-mono">
                      {selectedRun.baselineComparison.isNewRegression ? (
                        <span className="rounded bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.2 text-[10px] font-bold">
                          NEW REGRESSION
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 text-[10px] font-bold">
                          MATCHES BASELINE
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500">main @ {selectedRun.baselineComparison.mainSha}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {selectedRun.baselineComparison.details}
                    </p>
                  </div>
                </div>

                {/* Forensic Artifacts Strip */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <span className="font-bold text-slate-900 text-xs block">Forensic Proof Artifacts</span>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                    {selectedRun.artifacts.traceUrl ? (
                      <a
                        href={selectedRun.artifacts.traceUrl}
                        download
                        className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 px-2.5 py-1 text-slate-800 font-semibold transition-colors shadow-2xs"
                      >
                        <Download className="h-3 w-3 text-sky-600" />
                        <span>trace.zip</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-400 cursor-not-allowed">
                        <Download className="h-3 w-3 text-slate-400" />
                        <span>trace.zip</span>
                      </span>
                    )}

                    {selectedRun.artifacts.videoUrl && (
                      <a
                        href={selectedRun.artifacts.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 px-2.5 py-1 text-slate-800 font-semibold transition-colors shadow-2xs"
                      >
                        <Video className="h-3 w-3 text-slate-600" />
                        <span>video.webm</span>
                      </a>
                    )}

                    {selectedRun.artifacts.screenshotUrl && (
                      <a
                        href={selectedRun.artifacts.screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 px-2.5 py-1 text-slate-800 font-semibold transition-colors shadow-2xs"
                      >
                        <Camera className="h-3 w-3 text-emerald-600" />
                        <span>screenshot.png</span>
                      </a>
                    )}

                    <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-2xs font-medium">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      <span>DOM Snapshot Available</span>
                    </span>

                    <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-2xs font-medium">
                      <Network className="h-3 w-3 text-amber-600" />
                      <span>{selectedRun.artifacts.networkWaterfallCount} Network Requests</span>
                    </span>
                  </div>
                </div>

                {/* Execution Timing Breakdown */}
                {selectedRun.timing && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs font-mono space-y-1">
                    <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider block">
                      Execution Latency Breakdown
                    </span>
                    <div className="flex flex-wrap items-center gap-4 text-slate-600 font-semibold">
                      <span>Analysis: {selectedRun.timing.analysis_duration_s?.toFixed(2) ?? "0.00"}s</span>
                      <span>•</span>
                      <span>Journeys: {selectedRun.timing.journeys_duration_s?.toFixed(2) ?? "0.00"}s</span>
                      <span>•</span>
                      <span className="text-emerald-700 font-bold">
                        Total: {selectedRun.timing.total_duration_s?.toFixed(2) ?? "0.00"}s
                      </span>
                    </div>
                  </div>
                )}

                {/* Session Video Player */}
                {selectedRun.artifacts.videoUrl && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-slate-900 text-xs block">
                      Playwright Browser Session Video Replay
                    </span>
                    <CustomVideoPlayer
                      src={selectedRun.artifacts.videoUrl}
                      className="max-h-[320px] rounded-lg border border-slate-200 shadow-xs"
                    />
                  </div>
                )}

                {/* Annotated Failure Screenshot */}
                {selectedRun.artifacts.screenshotUrl && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50/50 overflow-hidden shadow-xs">
                    <div className="bg-rose-100/70 border-b border-rose-200 px-3 py-1.5 text-[11px] font-bold text-rose-800 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Camera className="h-3.5 w-3.5 text-rose-600" />
                        Annotated Failure Defect (Bounding Box &amp; Callouts)
                      </span>
                      <a
                        href={selectedRun.artifacts.screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-rose-700 hover:underline text-[10px] font-mono font-bold"
                      >
                        View Full Image ↗
                      </a>
                    </div>
                    <div className="p-2 bg-slate-50 flex justify-center">
                      <img
                        src={selectedRun.artifacts.screenshotUrl}
                        alt="Annotated Failure Screenshot"
                        className="max-h-[240px] object-contain rounded border border-slate-200"
                      />
                    </div>
                  </div>
                )}

                {/* AI Synthesized Fix Proposals or Remediation Prompt */}
                {selectedRun.fixProposals && selectedRun.fixProposals.length > 0 ? (
                  <FixProposalViewer
                    runId={selectedRun.id}
                    branch={selectedRun.branch}
                    proposals={selectedRun.fixProposals}
                    onFixApplied={fetchLiveRuns}
                  />
                ) : selectedRun.remediationPrompt ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-slate-700" />
                        Remediation Patch Prompt
                      </span>
                      <button
                        onClick={() => handleCopyPrompt(selectedRun.remediationPrompt!)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer shadow-2xs"
                      >
                        {copiedPrompt ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedPrompt ? "Copied" : "Copy Prompt"}</span>
                      </button>
                    </div>

                    <pre className="p-3 rounded border border-slate-200 bg-white font-mono text-[11px] text-slate-900 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto shadow-2xs">
                      {selectedRun.remediationPrompt}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          TIER 4: IN-FLIGHT DEVELOPER INTENT STREAM
          ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-950 text-sm flex items-center gap-2">
              <Workflow className="h-4 w-4 text-sky-600" />
              Per-User In-Flight Intent Stream
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live stream from Coding Agent Bridge daemon: &quot;What&apos;s being changed and why&quot; right now.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 border border-slate-200 font-semibold">
            Active User: {userEmail || "harmanpreet-singh-xyt"}
          </span>
        </div>

        {intents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center space-y-2">
            <div className="flex justify-center">
              <Workflow className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-xs font-bold text-slate-800">No In-Flight Agent Intents Streamed Yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Connect your local coding agent session using the bridge daemon to stream live file modifications and prompt intent:
            </p>
            <div className="pt-2">
              <code className="inline-block rounded bg-white border border-slate-200 text-slate-800 px-3 py-1.5 font-mono text-xs shadow-2xs font-semibold">
                uv run agent-bridge daemon
              </code>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {intents.map((intent) => (
              <div
                key={intent.id}
                className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs font-mono"
              >
                <div className="flex items-center justify-between text-[11px] font-sans">
                  <span className="font-semibold text-slate-900 truncate max-w-[160px]">{intent.branch}</span>
                  <span className="text-slate-400">{intent.time}</span>
                </div>

                <div className="text-slate-600 truncate">
                  <span className="text-slate-400">File: </span>
                  <span className="font-semibold text-slate-800">{intent.fileModified}</span>
                </div>

                <div className="text-slate-600 text-[11px] font-sans line-clamp-2">
                  <span className="font-semibold text-slate-900">Prompt: </span>
                  &quot;{intent.prompt}&quot;
                </div>

                <div className="text-slate-500 text-[10px] font-sans line-clamp-2">
                  <span className="font-semibold text-slate-700">Inferred: </span>
                  {intent.inferredIntent}
                </div>

                <div className="pt-1 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 truncate max-w-[120px]">{intent.user}</span>
                  {intent.status === "in-flight" ? (
                    <span className="rounded bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 font-bold font-mono">
                      IN-FLIGHT
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 font-bold font-mono">
                      VERIFIED
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ExternalTestModal
        isOpen={isExternalModalOpen}
        onClose={() => setIsExternalModalOpen(false)}
        onSuccess={() => fetchLiveRuns()}
      />
    </div>
  );
}
