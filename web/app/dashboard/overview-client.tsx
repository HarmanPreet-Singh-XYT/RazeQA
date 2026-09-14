"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertCircle,
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
import { FirstRunBriefing } from "@/components/first-run-briefing";
import { RunConfigDialog } from "@/components/run-config-dialog";
import { useDashboard } from "@/components/dashboard-context";
import { firstRunSatisfied, persistFirstRunRecord, type RunDispatchRecord } from "@/lib/first-run";

// --- Domain Models based on Real RazeQA Backend ---

export type RunRecord = {
  id: string;
  branch: string;
  sha: string;
  prNumber?: number;
  prUrl?: string;
  triggeringUser: string;
  triggerType: "on-demand" | "on-push" | "on-PR";
  status: "queued" | "running" | "passed" | "failed" | "flaky" | "superseded" | "cached" | "inconclusive";
  duration: string;
  /** Epoch ms the run was created, so an in-flight run can show elapsed time. */
  createdAtMs: number | null;
  timestamp: string;
  /** "Pending" until the run reaches a terminal state and actually has a verdict. */
  risk: "Low" | "Medium" | "High" | "Pending";
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
    /** True while the run has no verdict yet; nothing has been compared. */
    pending: boolean;
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
  /** One entry per route actually visited, with its own recording and trace. */
  journeyArtifacts: JourneyArtifact[];
  /** Stitched recording covering every visited route, when one could be built. */
  sessionReplayUrl: string | null;
  /** The agentic exploration session: what the agent did and noted, step by step. */
  agenticSession: AgenticSession | null;
  /** Why this run covered what it did: targeted / global_ui / unmapped / no_ui_impact. */
  changeImpact: ChangeImpact | null;
  effectiveScope: string | null;
};

export type ChangeImpact = {
  kind: string;
  rationale: string;
  routes: string[];
  globalFiles: string[];
  unmappedFiles: string[];
  nonUiFiles: string[];
};

export type AgenticNote = {
  url: string;
  did: string;
  saw: string;
};

export type AgenticSession = {
  stepsUsed: number;
  budget: number;
  pagesVisited: string[];
  stopReason: string | null;
  notes: AgenticNote[];
  findings: string[];
  durationMs: number;
  videoUrl: string | null;
};

export type JourneyArtifact = {
  name: string;
  route: string;
  passed: boolean;
  durationMs: number | null;
  videoUrl: string | null;
  traceUrl: string | null;
  screenshotUrl: string | null;
  lcpMs: number | null;
  cls: number | null;
  consoleErrors: string[];
  networkCount: number;
  scrollActions: number;
  linksChecked: number;
  brokenLinks: { url: string; status: number }[];
  navigations: { url: string; clicked: boolean; navigated: boolean; errored: boolean }[];
};

/** A run with a verdict. `queued`/`running` runs have not verified anything yet. */
export function isRunInFlight(run: Pick<RunRecord, "status">): boolean {
  return run.status === "running" || run.status === "queued";
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  if (safe < 60) return `${safe.toFixed(0)}s`;
  const minutes = Math.floor(safe / 60);
  const remainder = Math.round(safe % 60);
  return `${minutes}m ${remainder}s`;
}

export type IntentLog = {
  id: string;
  branch: string;
  /** All nullable: an absent capture must read as absent, not as invented text. */
  user: string | null;
  time: string | null;
  fileModified: string | null;
  prompt: string | null;
  inferredIntent: string | null;
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
  // "inconclusive" is the coverage gate: the run completed but executed no
  // journeys. Mapping it to "passed" (as the isFailed-else-passed chain did)
  // showed a green badge for a run that verified nothing.
  const isInconclusive = result.status === "inconclusive";
  const status: RunRecord["status"] =
    r.status === "superseded"
      ? "superseded"
      : r.status === "running"
      ? "running"
      : r.status === "queued"
      ? "queued"
      : r.status === "cached"
      ? "cached"
      : isInconclusive
      ? "inconclusive"
      : isFailed
      ? "failed"
      : "passed";
  const passedCount = result.passed_journeys?.length ?? (status === "passed" ? 1 : 0);
  const failedCount = result.failed_journeys?.length ?? (status === "failed" ? 1 : 0);
  const isNewRegression = Boolean(result.baseline_comparison?.has_new_regressions);
  const inFlight = status === "running" || status === "queued";
  const createdAtMs = r.created_at ? Date.parse(r.created_at) : NaN;
  const hasCreatedAt = Number.isFinite(createdAtMs);

  // Duration must mean something in every state:
  //  - finished run: the pipeline's measured total;
  //  - in-flight run: live elapsed time, recomputed on every poll (it used to
  //    read "0s" forever because the result payload does not exist yet);
  //  - unknown: an explicit placeholder instead of a false "0s".
  let durationSec: string;
  if (inFlight) {
    durationSec = hasCreatedAt
      ? `${formatDuration((Date.now() - createdAtMs) / 1000)} elapsed`
      : "starting…";
  } else {
    const reported = Number(result.duration_s ?? result.timing?.total_duration_s ?? 0);
    durationSec = reported > 0 ? formatDuration(reported) : r.duration || "—";
  }

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
    createdAtMs: hasCreatedAt ? createdAtMs : null,
    timestamp: r.created_at ? new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now",
    // A run that has not finished has no risk verdict and has verified nothing.
    // Reporting "Low risk / verified green" mid-run was the single most
    // misleading thing this dashboard did.
    risk: inFlight ? "Pending" : (result.risk_tag as any) || (isExternal ? "Low" : isFailed ? "High" : "Low"),
    riskRationale: inFlight
      ? "Sandbox is still executing journeys. Risk, findings and the baseline comparison appear when the run finishes."
      : result.summary ||
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
      pending: inFlight,
      details: inFlight
        ? "No comparison yet — the baseline is evaluated once journeys finish."
        : isNewRegression
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
    journeyArtifacts: buildJourneyArtifacts(result),
    sessionReplayUrl: resolveArtifactUrl(result.session_replay_url) || null,
    agenticSession: buildAgenticSession(result.agentic_session),
    changeImpact: buildChangeImpact(result.change_impact),
    effectiveScope: result.effective_scope ?? null,
  };
}

function buildChangeImpact(raw: any): ChangeImpact | null {
  if (!raw || typeof raw !== "object" || !raw.kind) return null;
  return {
    kind: String(raw.kind),
    rationale: String(raw.rationale ?? ""),
    routes: Array.isArray(raw.routes) ? raw.routes : [],
    globalFiles: Array.isArray(raw.global_files) ? raw.global_files : [],
    unmappedFiles: Array.isArray(raw.unmapped_files) ? raw.unmapped_files : [],
    nonUiFiles: Array.isArray(raw.non_ui_files) ? raw.non_ui_files : [],
  };
}

function buildAgenticSession(raw: any): AgenticSession | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    stepsUsed: Number(raw.steps_used ?? 0),
    budget: Number(raw.budget ?? 0),
    pagesVisited: Array.isArray(raw.pages_visited) ? raw.pages_visited : [],
    stopReason: raw.stop_reason ?? null,
    notes: Array.isArray(raw.notes)
      ? raw.notes.map((n: any) => ({
          url: String(n?.url ?? ""),
          did: String(n?.did ?? ""),
          saw: String(n?.saw ?? ""),
        }))
      : [],
    findings: Array.isArray(raw.findings) ? raw.findings : [],
    durationMs: Number(raw.duration_ms ?? 0),
    videoUrl: resolveArtifactUrl(raw.video_url) || null,
  };
}

/**
 * Per-route results for a run.
 *
 * The backend records one artifact set per visited route, but the dashboard only
 * ever surfaced the primary (first-failing) one — so a full sweep that visited
 * 14 pages looked like it had "not navigated anywhere". Each entry keeps its own
 * recording, trace and screenshot.
 */
function buildJourneyArtifacts(result: any): JourneyArtifact[] {
  const raw = Array.isArray(result?.journey_artifacts) ? result.journey_artifacts : [];
  const failedNames = new Set<string>(
    (result?.failed_journeys || []).map((f: any) => String(f?.name ?? ""))
  );

  return raw.map((a: any, index: number) => {
    const vitals = a?.web_vitals || {};
    return {
      name: String(a?.name || a?.route || `journey-${index + 1}`),
      route: String(a?.route || "/"),
      // Anything not in failed_journeys completed without a recorded failure.
      passed: !failedNames.has(String(a?.name ?? "")),
      durationMs: typeof a?.duration_ms === "number" ? a.duration_ms : null,
      videoUrl: resolveArtifactUrl(a?.video_url) || null,
      traceUrl: resolveArtifactUrl(a?.trace_url) || null,
      screenshotUrl: resolveArtifactUrl(a?.annotated_screenshot_url) || null,
      lcpMs: typeof vitals?.lcp_ms === "number" ? vitals.lcp_ms : null,
      cls: typeof vitals?.cls === "number" ? vitals.cls : null,
      consoleErrors: Array.isArray(a?.console_errors) ? a.console_errors : [],
      networkCount: Array.isArray(a?.network_requests) ? a.network_requests.length : 0,
      scrollActions: typeof a?.scroll_actions === "number" ? a.scroll_actions : 0,
      linksChecked: Array.isArray(a?.links_checked) ? a.links_checked.length : 0,
      brokenLinks: Array.isArray(a?.broken_links) ? a.broken_links : [],
      navigations: Array.isArray(a?.navigation_checks) ? a.navigation_checks : [],
    };
  });
}

export function OverviewClient({
  userEmail,
  promptFirstRun = false,
}: { userEmail?: string; promptFirstRun?: boolean } = {}) {
  const { activeRepo, setActiveRepo } = useDashboard();

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [intents, setIntents] = useState<IntentLog[]>([]);
  const [gitInfo, setGitInfo] = useState<{ sha?: string; branch?: string }>({});
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(true);
  // True only once the run list came from an authoritative source. An empty list
  // from a fallback path (engine offline, tenant scope unresolved) is NOT
  // evidence that the project has no runs — treating it as such produced the
  // "0 results, then the poll fills the list in" flash.
  const [runsLoaded, setRunsLoaded] = useState<boolean>(false);
  // True once the runs request has settled at all, including the fallback paths
  // that cannot be authoritative. Without it an unreachable engine left the
  // panel on "Loading verification history…" forever, because `runsLoaded` is
  // only ever set on an authoritative answer.
  const [runsSettled, setRunsSettled] = useState<boolean>(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
  const [engineConnected, setEngineConnected] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  // First-run briefing: shown for a project that has never been verified, and
  // closable only for this session so it returns until a run is dispatched.
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  const [dispatchedRunId, setDispatchedRunId] = useState<string | null>(null);
  // Tracks the newest run id seen so a newly dispatched run can be selected
  // automatically without stealing focus on every 4s poll.
  const newestRunIdRef = useRef<string | null>(null);

  const activeRepoName = activeRepo || projects[0]?.repo_full_name || "";
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
          // Only an engine-sourced, warning-free response may claim "no runs".
          const connected = data.engineConnected !== undefined ? Boolean(data.engineConnected) : true;
          setEngineConnected(connected);
          if (liveMapped.length > 0 || (connected && !data.warning)) {
            setRunsLoaded(true);
          }
          // Follow the newest run when a new one appears, but never yank the
          // selection away from a run the user is reading while polling.
          const newestId: string | null = liveMapped[0]?.id ?? null;
          const isNewRun = Boolean(newestId) && newestId !== newestRunIdRef.current;
          newestRunIdRef.current = newestId;
          setSelectedRunId((prev) => {
            if (isNewRun) return newestId as string;
            if (!prev || !liveMapped.some((r: RunRecord) => r.id === prev)) {
              return newestId ?? "";
            }
            return prev;
          });
        }
        setEngineConnected(data.engineConnected !== undefined ? Boolean(data.engineConnected) : true);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setRunsError(errJson.error || `Failed to fetch runs (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setRunsError(err?.message || "Could not reach RazeQA server.");
    } finally {
      setIsRefreshing(false);
      setIsLoadingRuns(false);
      // The request is over, whatever the answer was. The panel must stop
      // claiming to be loading; the copy below distinguishes an authoritative
      // empty list from an unreachable engine.
      setRunsSettled(true);
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
            user: e.user || e.repo || null,
            time: e.timestamp
              ? new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : null,
            fileModified: Array.isArray(e.files) ? e.files.join(", ") : e.files || null,
            prompt: e.prompt_summary || e.prompt || null,
            inferredIntent: e.reasoning || e.inferredIntent || null,
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

  // On-demand runs now go through the run-config dialog, which asks what the
  // run should cover (full sweep / one commit / one commit's changes / a range)
  // instead of silently fixing it to "changed + functional" as this used to.
  const openRunDialog = () => setIsRunDialogOpen(true);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  // A pass rate over runs that have not finished is meaningless: an in-flight
  // run counted as a non-pass, so a single running job showed "0.0% (0/1)".
  const settledRuns = runs.filter(
    (r) => r.status === "passed" || r.status === "failed" || r.status === "superseded"
  );
  const inFlightRuns = runs.filter(isRunInFlight);
  const passedRuns = settledRuns.filter((r) => r.status === "passed").length;
  const totalRuns = runs.length;
  const passRate =
    settledRuns.length > 0 ? ((passedRuns / settledRuns.length) * 100).toFixed(1) : "--";
  const cachedRuns = runs.filter((r) => r.status === "cached").length;

  // The briefing is a property of the project, not of the visit: it shows while
  // there is no run history AND no record that a first run was ever dispatched.
  // "Not now" only hides it for this session.
  //
  // Two things must hold before it may appear: the project must be loaded, and
  // nothing may have been verified (no `first_run` record, no runs). The normal
  // path additionally waits for an *authoritative* empty run list (`runsLoaded`)
  // so a fallback path that happened to return nothing cannot conjure the
  // briefing. `promptFirstRun` — set by the import flow — waives that last
  // requirement: the project was just created, and waiting for an authoritative
  // answer means never showing the briefing at all while the engine is
  // unreachable, which is precisely when the offer to run the first
  // verification matters most.
  const isExternalProject = activeRepoName.startsWith("external:");
  const showRunsLoading = isLoadingRuns || !runsSettled;
  const runsAnswerIsAuthoritative = runsLoaded && !isLoadingRuns && !runsError;
  // An empty list we cannot vouch for: the engine is unreachable, or the last
  // poll failed. The panel says so instead of claiming there are no runs.
  const runsUncertain = !engineConnected || Boolean(runsError);
  const showFirstRunBriefing =
    !briefingDismissed &&
    !isExternalProject &&
    Boolean(activeProject) &&
    runs.length === 0 &&
    !firstRunSatisfied(activeRepoName, activeProject?.settings) &&
    (promptFirstRun ? runsSettled : runsAnswerIsAuthoritative);

  // Shared by the first-run briefing and the everyday run dialog: once the
  // engine has accepted a run, stop nagging and show what was queued. Dispatching
  // from the dialog settles the first-run question too, so the briefing does not
  // come back for a project that has now been verified.
  const handleRunDispatched = (record: RunDispatchRecord) => {
    setBriefingDismissed(true);
    setIsRunDialogOpen(false);
    setDispatchedRunId(record.run_id ?? "queued");
    if (
      activeRepoName &&
      !isExternalProject &&
      !firstRunSatisfied(activeRepoName, activeProject?.settings)
    ) {
      void persistFirstRunRecord(activeRepoName, record);
    }
    fetchLiveRuns();
  };

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
              RazeQA Platform Health
            </span>
            <span className="rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-mono font-semibold text-slate-900">
              {activeRepoName}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={openRunDialog}
              disabled={!activeRepoName || isExternalProject}
              title={
                isExternalProject
                  ? "External sites are verified from the Add menu → Verify External Site."
                  : undefined
              }
              className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-white" />
              <span>Run Verification</span>
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
              {settledRuns.length > 0
                ? `${passRate}% (${passedRuns}/${settledRuns.length})`
                : inFlightRuns.length > 0
                ? "Run in progress"
                : "Awaiting runs"}
            </div>
            <span className="text-[10px] text-emerald-600 font-sans font-medium">
              {inFlightRuns.length > 0
                ? `${inFlightRuns.length} running · excluded until finished`
                : settledRuns.length > 0
                ? "Settled runs only"
                : "No tests executed yet"}
            </span>
          </div>

          {/* Signal 3: Deterministic Caching.
              This used to read `totalRuns * 15000` "tokens saved via commit SHA
              deduplication" — an invented per-run constant presented as a measured
              saving — and then counted *every* run as "deduplicated", which was
              just as false. Only runs the engine actually served from cache count. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">Deterministic Caching</span>
            <div className="text-slate-900 font-bold text-sm font-mono">
              {cachedRuns > 0
                ? `${cachedRuns} cache ${cachedRuns === 1 ? "hit" : "hits"}`
                : "No cache hits"}
            </div>
            <span className="text-[10px] text-slate-500 font-sans">Commit SHA reuse — token savings not metered</span>
          </div>

          {/* Signal 4: GitHub App Connection */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase block font-sans font-medium">GitHub Integration</span>
            <div className="flex items-center gap-1.5 text-slate-900 font-bold">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>{activeProject?.installation_id ? "App Connected" : "Ready"}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              {activeProject?.installation_id ? `Installation #${activeProject.installation_id}` : "Autonomous QA Active"}
            </span>
          </div>
        </div>
      </div>

      {/* Runs errors are surfaced through the runs list / briefing gate rather
          than a banner here: the 4s poll would re-raise a dismissed one. */}

      {dispatchedRunId && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="truncate">
              First verification dispatched
              {dispatchedRunId !== "queued" && (
                <span className="font-mono"> ({dispatchedRunId})</span>
              )}
              . The sandbox is booting — journeys and forensics stream in below.
            </span>
          </div>
          <button
            onClick={() => setDispatchedRunId(null)}
            className="text-emerald-700 hover:text-emerald-900 font-semibold shrink-0"
          >
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
              <span>
                {activeProject?.settings?.roles && Object.keys(activeProject.settings.roles).length > 0
                  ? `${Object.keys(activeProject.settings.roles).length} Personas Configured`
                  : "Standard Sandbox"}
              </span>
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
              {showRunsLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </div>
            {/* Do not assert "no runs" before an authoritative answer arrives:
                an in-flight job used to be reported as absent, then appear a
                moment later on the poll. */}
            <h3 className="text-sm font-bold text-slate-950">
              {showRunsLoading
                ? "Loading verification history…"
                : runsUncertain
                ? "Last known history — engine offline"
                : "No Verification Runs Recorded"}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {showRunsLoading
                ? "Connecting to the RazeQA engine and reading recorded runs."
                : runsUncertain
                ? "The engine is unreachable, so this list may be incomplete. It refreshes automatically."
                : "Trigger a verification run to explore user journeys and generate forensics."}
            </p>
            {!showRunsLoading && (
              <Button
                onClick={openRunDialog}
                disabled={!activeRepoName || isExternalProject || !engineConnected}
                className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5 fill-white mr-1" />
                <span>Trigger First Verification Run</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left Column: Runs List Selector (4 cols) */}
            <div className="lg:col-span-4 divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
              {runs.map((run) => {
                const isSelected = selectedRun && run.id === selectedRun.id;
                const isPassed = run.status === "passed";
                const isFailed = run.status === "failed";
                const isInconclusive = run.status === "inconclusive";

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
                            : isInconclusive
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : "bg-sky-50 text-sky-700 border-sky-200"
                        }`}
                      >
                        {isInconclusive ? "NOT VERIFIED" : run.status.toUpperCase()}
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
                      href={`/dashboard/runs/${selectedRun.id}`}
                      className="rounded-md border border-slate-900 bg-slate-950 hover:bg-slate-800 text-white px-2.5 py-0.5 text-xs font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                    >
                      <Play className="h-3 w-3" />
                      <span>Run Detail</span>
                    </Link>
                    <Link
                      href={`/dashboard/runs/${selectedRun.id}/analytics`}
                      className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 px-2.5 py-0.5 text-xs font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                    >
                      <Compass className="h-3 w-3 text-slate-600" />
                      <span>Path &amp; Quality Analytics</span>
                    </Link>
                  </div>
                </div>

                {/* Why this run covered what it did. Without this, "it only
                    visited one page" or "it visited nothing" is unexplainable. */}
                {selectedRun.changeImpact && (
                  <div
                    className={`rounded-lg border p-2.5 text-[11px] flex items-start gap-2 ${
                      selectedRun.changeImpact.kind === "no_ui_impact"
                        ? "border-slate-200 bg-slate-50 text-slate-700"
                        : selectedRun.changeImpact.kind === "global_ui"
                        ? "border-sky-200 bg-sky-50 text-sky-900"
                        : selectedRun.changeImpact.kind === "unmapped"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-bold uppercase tracking-wider text-[10px]">
                        {selectedRun.changeImpact.kind === "targeted"
                          ? "Targeted change"
                          : selectedRun.changeImpact.kind === "global_ui"
                          ? "App-wide change"
                          : selectedRun.changeImpact.kind === "no_ui_impact"
                          ? "No user-visible change"
                          : selectedRun.changeImpact.kind === "unmapped"
                          ? "Blast radius unknown"
                          : "Change impact"}
                      </span>
                      <p className="mt-0.5 leading-relaxed">{selectedRun.changeImpact.rationale}</p>
                      {selectedRun.changeImpact.routes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedRun.changeImpact.routes.map((route) => (
                            <span
                              key={route}
                              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                            >
                              {route}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

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
                          : selectedRun.risk === "Pending"
                          ? "bg-amber-100 text-amber-800 border border-amber-200"
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
                    {isRunInFlight(selectedRun) ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Awaiting results — {selectedRun.duration}
                      </span>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>

                  {/* Baseline Comparison */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                    <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider block">
                      Baseline Comparison (vs main)
                    </span>
                    <div className="flex items-center gap-1.5 font-mono">
                      {selectedRun.baselineComparison.pending ? (
                        <span className="rounded bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.2 text-[10px] font-bold">
                          PENDING
                        </span>
                      ) : selectedRun.baselineComparison.isNewRegression ? (
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
                        <span>{selectedRun.artifacts.videoUrl.endsWith(".mp4") ? "video.mp4" : selectedRun.artifacts.videoUrl.endsWith(".webm") ? "video.webm" : "video"}</span>
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

                    {selectedRun.artifacts.domSnapshotAvailable ? (
                      <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-2xs font-medium">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        <span>DOM Snapshot Available</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-400 font-medium">
                        <XCircle className="h-3 w-3 text-slate-400" />
                        <span>No DOM Snapshot</span>
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 shadow-2xs font-medium ${
                        selectedRun.artifacts.networkWaterfallCount > 0
                          ? "border-slate-200 bg-white text-slate-700"
                          : "border-slate-200 bg-slate-100 text-slate-400"
                      }`}
                    >
                      <Network className="h-3 w-3 text-amber-600" />
                      <span>
                        {selectedRun.artifacts.networkWaterfallCount > 0
                          ? `${selectedRun.artifacts.networkWaterfallCount} Network Requests`
                          : "No network log captured"}
                      </span>
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
                      <span>Analysis: {selectedRun.timing.analysis_duration_s?.toFixed(2) ?? "—"}s</span>
                      <span>•</span>
                      <span>Journeys: {selectedRun.timing.journeys_duration_s?.toFixed(2) ?? "—"}s</span>
                      <span>•</span>
                      <span className="text-emerald-700 font-bold">
                        Total: {selectedRun.timing.total_duration_s?.toFixed(2) ?? "—"}s
                      </span>
                    </div>
                  </div>
                )}

                {/* Per-route journey results. Without this, a full sweep that
                    visited 14 pages looked like it only ran one. */}
                {selectedRun.journeyArtifacts.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">
                        Routes visited ({selectedRun.journeyArtifacts.length})
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {selectedRun.journeyArtifacts.filter((j) => j.passed).length} clean ·{" "}
                        {selectedRun.journeyArtifacts.filter((j) => !j.passed).length} with findings ·{" "}
                        {selectedRun.journeyArtifacts.reduce((n, j) => n + j.linksChecked, 0)} links
                        checked
                      </span>
                    </div>
                    <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white overflow-hidden max-h-72 overflow-y-auto">
                      {selectedRun.journeyArtifacts.map((j) => (
                        <div
                          key={j.name}
                          className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 text-[11px]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {j.passed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                            )}
                            <span className="font-mono font-semibold text-slate-900 truncate">
                              {j.route}
                            </span>
                            {j.durationMs !== null && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                {(j.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                            {j.lcpMs !== null && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                LCP {Math.round(j.lcpMs)}ms
                              </span>
                            )}
                            {j.consoleErrors.length > 0 && (
                              <span
                                className="text-[10px] text-amber-700 font-mono"
                                title={j.consoleErrors.join("\n")}
                              >
                                {j.consoleErrors.length} console error
                                {j.consoleErrors.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {j.scrollActions > 0 && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                {j.scrollActions} scrolls
                              </span>
                            )}
                            {j.linksChecked > 0 && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                {j.linksChecked} links
                              </span>
                            )}
                            {j.navigations.filter((n) => n.navigated).length > 0 && (
                              <span className="text-[10px] text-sky-700 font-mono">
                                {j.navigations.filter((n) => n.navigated).length} clicked through
                              </span>
                            )}
                            {j.brokenLinks.length > 0 && (
                              <span
                                className="text-[10px] text-rose-700 font-bold font-mono"
                                title={j.brokenLinks
                                  .map((b) => `${b.url} (HTTP ${b.status})`)
                                  .join("\n")}
                              >
                                {j.brokenLinks.length} broken link
                                {j.brokenLinks.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {j.videoUrl && (
                              <a
                                href={j.videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                              >
                                <Video className="h-2.5 w-2.5 text-slate-500" />
                                video
                              </a>
                            )}
                            {j.traceUrl && (
                              <a
                                href={j.traceUrl}
                                download
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                              >
                                <Download className="h-2.5 w-2.5 text-sky-600" />
                                trace
                              </a>
                            )}
                            {j.screenshotUrl && (
                              <a
                                href={j.screenshotUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                              >
                                <Camera className="h-2.5 w-2.5 text-emerald-600" />
                                shot
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agentic exploration notebook: what the agent thought and did,
                    step by step. Advisory — it never decides pass/fail. */}
                {selectedRun.agenticSession && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                        <Workflow className="h-3.5 w-3.5 text-sky-600" />
                        Agent exploration notebook
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {selectedRun.agenticSession.stepsUsed}/{selectedRun.agenticSession.budget} steps
                        {" · "}
                        {selectedRun.agenticSession.pagesVisited.length} pages
                        {" · "}
                        {(selectedRun.agenticSession.durationMs / 1000).toFixed(0)}s
                        {selectedRun.agenticSession.stopReason
                          ? ` · stopped: ${selectedRun.agenticSession.stopReason}`
                          : ""}
                      </span>
                    </div>

                    {selectedRun.agenticSession.notes.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        The agent recorded no steps for this run.
                      </p>
                    ) : (
                      <ol className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {selectedRun.agenticSession.notes.map((note, index) => (
                          <li key={index} className="px-2.5 py-1.5 text-[11px] flex gap-2">
                            <span className="font-mono text-[10px] text-slate-400 shrink-0 w-5 text-right">
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-1.5">
                                <span className="font-mono text-[10px] text-slate-500 truncate max-w-[220px]">
                                  {note.url}
                                </span>
                                <span className="font-semibold text-slate-800">{note.did}</span>
                              </div>
                              {note.saw && (
                                <p className="text-[10px] text-slate-500 mt-0.5">{note.saw}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}

                    {selectedRun.agenticSession.findings.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                          Agent findings (advisory)
                        </p>
                        <ul className="text-[11px] text-amber-900 list-disc pl-4 space-y-0.5">
                          {selectedRun.agenticSession.findings.map((finding, index) => (
                            <li key={index}>{finding}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedRun.agenticSession.pagesVisited.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedRun.agenticSession.pagesVisited.map((page) => (
                          <span
                            key={page}
                            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                          >
                            {page}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Session Video Player */}
                {selectedRun.artifacts.videoUrl && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-slate-900 text-xs block">
                      {selectedRun.sessionReplayUrl
                        ? `Session replay — all ${selectedRun.journeyArtifacts.length} routes in visit order`
                        : "Playwright Browser Session Video Replay"}
                    </span>
                    <CustomVideoPlayer
                      src={selectedRun.artifacts.videoUrl}
                      className="max-h-[320px] rounded-lg border border-slate-200 shadow-xs"
                    />
                    {selectedRun.sessionReplayUrl && (
                      <p className="text-[10px] text-slate-500">
                        Each route is recorded in its own browser context and the clips are stitched
                        in visit order. Per-route recordings are listed under Routes visited above.
                      </p>
                    )}
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
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <Workflow className="h-4 w-4 text-slate-400" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-800">
                  This stream is optional and currently empty
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed max-w-2xl">
                  RazeQA already verifies commits from git on its own — nothing here is required for
                  a run. This panel only fills up if you also run the Coding Agent Bridge alongside
                  your editor, which streams <em>why</em> a file changed (your prompt and the
                  agent&apos;s reasoning) so the diff analyzer has extra context.
                </p>
              </div>
            </div>
            <details className="group pl-11">
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-600 hover:text-slate-900 select-none">
                Connect a local agent session
              </summary>
              <div className="pt-2 space-y-1.5">
                <code className="inline-block rounded bg-white border border-slate-200 text-slate-800 px-3 py-1.5 font-mono text-[11px] shadow-2xs">
                  uv --directory agent run agent-bridge daemon
                </code>
                <p className="text-[10px] text-slate-400">
                  Run from the repository root. Intents appear here within a few seconds of your next
                  edit.
                </p>
              </div>
            </details>
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
                  <span className="text-slate-400">{intent.time || "time not recorded"}</span>
                </div>

                <div className="text-slate-600 truncate">
                  <span className="text-slate-400">File: </span>
                  <span className="font-semibold text-slate-800">{intent.fileModified || "no file recorded"}</span>
                </div>

                <div className="text-slate-600 text-[11px] font-sans line-clamp-2">
                  <span className="font-semibold text-slate-900">Prompt: </span>
                  {intent.prompt ? `"${intent.prompt}"` : "no prompt captured"}
                </div>

                <div className="text-slate-500 text-[10px] font-sans line-clamp-2">
                  <span className="font-semibold text-slate-700">Inferred: </span>
                  {intent.inferredIntent || "no reasoning captured"}
                </div>

                <div className="pt-1 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 truncate max-w-[120px]">{intent.user || "unknown"}</span>
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

      <RunConfigDialog
        isOpen={isRunDialogOpen && !isExternalProject && Boolean(activeRepoName)}
        repo={activeRepoName}
        projectName={activeProject?.name}
        defaultBranch={activeProject?.default_branch || gitInfo.branch || "main"}
        defaultTestType={activeProject?.settings?.test_type}
        onClose={() => setIsRunDialogOpen(false)}
        onDispatched={handleRunDispatched}
      />

      {showFirstRunBriefing && activeProject && (
        <FirstRunBriefing
          repo={activeRepoName}
          projectName={activeProject?.name}
          defaultBranch={activeProject?.default_branch || gitInfo.branch || "main"}
          defaultTestType={activeProject?.settings?.test_type}
          onDispatched={handleRunDispatched}
          onSkip={() => setBriefingDismissed(true)}
        />
      )}
    </div>
  );
}
