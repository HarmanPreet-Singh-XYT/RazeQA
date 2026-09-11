"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
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
  Flame,
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
import { logout } from "@/app/login/actions";
import { ExternalTestModal } from "@/components/external-test-modal";

// --- Domain Models based on Specification ---

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
  // Risk tag + rationale from diff/intent analyzer
  risk: "Low" | "Medium" | "High";
  riskRationale: string;
  // Scope and test type
  scope: "changed" | "full";
  testType: "functional" | "functional+visual";
  // Bucket counts
  bucketCounts: {
    passed: number;
    failed: number;
    additionalFindings: number;
  };
  additionalFindingsDetails?: string[];
  // Baseline comparison result
  baselineComparison: {
    isNewRegression: boolean;
    mainSha: string;
    details: string;
  };
  // Forensic artifacts
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
  // Remediation prompt & fix proposals
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

// Seeded realistic data strictly adhering to user's spec
const RUNS_DATA: RunRecord[] = [
  {
    id: "run_f1e2d3c4",
    branch: "feat/quick-checkout",
    sha: "f1e2d3c",
    prNumber: 42,
    prUrl: "https://github.com/acme-corp/ecommerce-web/pull/42",
    triggeringUser: "harman (via Claude Code)",
    triggerType: "on-PR",
    status: "failed",
    duration: "1.89s",
    timestamp: "2 mins ago",
    risk: "High",
    riskRationale:
      "Modified payment button session handler without passing downstream customer_address token to charge invoice payload.",
    scope: "changed",
    testType: "functional+visual",
    bucketCounts: {
      passed: 4,
      failed: 1,
      additionalFindings: 2,
    },
    additionalFindingsDetails: [
      "Unhandled promise rejection on window.ApplePaySession cancellation",
      "Cumulative Layout Shift (CLS 0.18) during payment sheet dismissal",
    ],
    baselineComparison: {
      isNewRegression: true,
      mainSha: "9c8b7a6",
      details: "New regression introduced on this branch. Baseline on main (9c8b7a6) passed all 5 assertions.",
    },
    artifacts: {
      traceUrl: "artifacts/runs/run_f1e2d3c4/trace.zip",
      videoUrl: "artifacts/runs/run_f1e2d3c4/video.webm",
      domSnapshotAvailable: true,
      networkWaterfallCount: 6,
    },
    remediationPrompt: `## 🚨 Autonomous PR Verification Failed: /checkout
> **Risk Assessment:** HIGH RISK
> **Failing Target:** POST /api/charge returned HTTP 422 Unprocessable Entity
> **Baseline State:** New regression (main @ 9c8b7a6 passed)

### 🔍 Forensic Evidence
- **Error:** 'Invalid customer address for Apple Pay token invoice generation'
- **Artifacts:** artifacts/runs/run_f1e2d3c4/trace.zip, video.webm

### 🧠 Intent Context Hand-off
- User Prompt: "Add instant Apple Pay button to checkout"
- Agent Intent: "Bypass standard address form for 1-tap checkout"
- Touched: components/pay-button.tsx, app/checkout/page.tsx

### 📋 Ready-to-Paste Remediation Prompt for Claude Code:
Fix regression in /checkout: Ensure the Apple Pay session handler in components/pay-button.tsx passes the default billing address token downstream to /api/charge.`,
  },
  {
    id: "run_8a7b6c5d",
    branch: "feat/quick-checkout",
    sha: "8a7b6c5",
    prNumber: 42,
    prUrl: "https://github.com/acme-corp/ecommerce-web/pull/42",
    triggeringUser: "harman (via Claude Code)",
    triggerType: "on-demand",
    status: "passed",
    duration: "0.24s",
    timestamp: "14 mins ago",
    risk: "Low",
    riskRationale: "Pre-flight authentication probe against seeded test user.",
    scope: "changed",
    testType: "functional",
    bucketCounts: {
      passed: 3,
      failed: 0,
      additionalFindings: 0,
    },
    baselineComparison: {
      isNewRegression: false,
      mainSha: "9c8b7a6",
      details: "Matches baseline behavior on main.",
    },
    artifacts: {
      traceUrl: "artifacts/runs/run_8a7b6c5d/trace.zip",
      videoUrl: "artifacts/runs/run_8a7b6c5d/video.webm",
      domSnapshotAvailable: true,
      networkWaterfallCount: 2,
    },
  },
  {
    id: "run_4e3d2c1b",
    branch: "fix/nav-overflow",
    sha: "4e3d2c1",
    prNumber: 41,
    prUrl: "https://github.com/acme-corp/ecommerce-web/pull/41",
    triggeringUser: "sarah (Developer)",
    triggerType: "on-push",
    status: "passed",
    duration: "1.42s",
    timestamp: "45 mins ago",
    risk: "Low",
    riskRationale: "CSS containment fix on mobile viewports (< 768px).",
    scope: "changed",
    testType: "functional+visual",
    bucketCounts: {
      passed: 5,
      failed: 0,
      additionalFindings: 1,
    },
    additionalFindingsDetails: ["Minor font smoothing warning on Safari iOS sandbox"],
    baselineComparison: {
      isNewRegression: false,
      mainSha: "9c8b7a6",
      details: "Resolved previous viewport overflow on main.",
    },
    artifacts: {
      traceUrl: "artifacts/runs/run_4e3d2c1b/trace.zip",
      videoUrl: "artifacts/runs/run_4e3d2c1b/video.webm",
      domSnapshotAvailable: true,
      networkWaterfallCount: 4,
    },
  },
  {
    id: "run_9c8b7a6f",
    branch: "main",
    sha: "9c8b7a6",
    triggeringUser: "GitHub Actions",
    triggerType: "on-push",
    status: "passed",
    duration: "1.15s",
    timestamp: "3 hours ago",
    risk: "Low",
    riskRationale: "Baseline visual and functional snapshot sync on default branch.",
    scope: "full",
    testType: "functional+visual",
    bucketCounts: {
      passed: 16,
      failed: 0,
      additionalFindings: 0,
    },
    baselineComparison: {
      isNewRegression: false,
      mainSha: "9c8b7a6",
      details: "Gold baseline snapshot established for main.",
    },
    artifacts: {
      traceUrl: "artifacts/runs/run_9c8b7a6f/trace.zip",
      videoUrl: "artifacts/runs/run_9c8b7a6f/video.webm",
      domSnapshotAvailable: true,
      networkWaterfallCount: 12,
    },
  },
];

const IN_FLIGHT_INTENTS: IntentLog[] = [
  {
    id: "int_101",
    branch: "feat/quick-checkout",
    user: "harman (Claude Code)",
    time: "Just now",
    fileModified: "components/pay-button.tsx",
    prompt: "Add instant Apple Pay button to checkout",
    inferredIntent: "Bypass standard address form for 1-tap checkout",
    status: "in-flight",
  },
  {
    id: "int_102",
    branch: "feat/quick-checkout",
    user: "harman (Claude Code)",
    time: "4 mins ago",
    fileModified: "app/api/charge/route.ts",
    prompt: "Add Apple Pay token charge handler",
    inferredIntent: "Forward token to payment gateway server-side",
    status: "verified",
  },
  {
    id: "int_098",
    branch: "fix/nav-overflow",
    user: "sarah (Cursor)",
    time: "48 mins ago",
    fileModified: "components/nav.tsx",
    prompt: "Fix horizontal scroll overflow on mobile viewports",
    inferredIntent: "Add overflow-x-hidden to outer navigation wrapper",
    status: "verified",
  },
];

/** Artifact URLs from the backend are relative engine paths — rewrite them to
 * go through this app's own /api/artifacts proxy, which holds AGENT_API_KEY
 * server-side (the engine requires a bearer token the browser doesn't have). */
function resolveArtifactUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `/api/artifacts?file=${encodeURIComponent(url)}`;
}

function mapBackendRunToDashboardRun(r: any): RunRecord {
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
      : isFailed
      ? "failed"
      : "passed";
  const passedCount = result.passed_journeys?.length ?? (status === "passed" ? 1 : 0);
  const failedCount = result.failed_journeys?.length ?? (status === "failed" ? 1 : 0);
  const isNewRegression = Boolean(result.baseline_comparison?.has_new_regressions);

  return {
    id: r.run_id,
    branch: isExternal ? `🌐 ${r.branch}` : r.branch,
    sha: isExternal ? r.sha : (r.sha?.slice(0, 7) || "unknown"),
    prNumber: isExternal ? 0 : 42,
    prUrl: isExternal ? r.sha : "https://github.com/acme-corp/ecommerce-web/pull/42",
    triggeringUser: isExternal ? "External Site Tester" : "harman (via Coding Agent Bridge)",
    triggerType: "on-demand",
    status,
    duration: result.duration_s
      ? `${result.duration_s}s`
      : result.timing?.total_duration_s
      ? `${result.timing.total_duration_s.toFixed(2)}s`
      : "1.24s",
    timestamp: new Date(r.created_at || Date.now()).toLocaleTimeString(),
    risk: (result.risk_tag as any) || (isExternal ? "Live QA" : "Medium"),
    riskRationale: result.summary || result.rationale || "Real-time automated journey verification against preview sandbox.",
    scope: (r.scope as any) || "changed",
    testType: (r.test_type as any) || "functional",
    bucketCounts: {
      passed: passedCount,
      failed: failedCount,
      additionalFindings: result.additional_findings?.length ?? 0,
    },
    baselineComparison: {
      isNewRegression,
      mainSha: "9c8b7a6",
      details: isNewRegression
        ? "New regression introduced on this branch. Baseline on main passed."
        : "Matches baseline behavior on main.",
    },
    artifacts: {
      traceUrl: resolveArtifactUrl(r.trace_url || result.trace_url) || null,
      videoUrl: resolveArtifactUrl(r.video_url || result.video_url) || null,
      screenshotUrl: resolveArtifactUrl(result.screenshot_url) || null,
      domSnapshotAvailable: true,
      networkWaterfallCount: 4,
    },
    timing: result.timing,
    remediationPrompt: result.remediation_prompt || (isFailed ? `## 🚨 Verification Failed on ${r.branch}\nPlease inspect the failing journeys and remediate.` : undefined),
    fixProposals: result.fix_proposals || [],
  };
}

export function OverviewClient({ userEmail }: { userEmail: string }) {
  const [runs, setRuns] = useState<RunRecord[]>(RUNS_DATA);
  const [selectedRunId, setSelectedRunId] = useState<string>(RUNS_DATA[0].id);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false);
  const [engineConnected, setEngineConnected] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];

  const fetchLiveRuns = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/runs");
      const data = await res.json();
      if (data.runs && Array.isArray(data.runs) && data.runs.length > 0) {
        const liveMapped = data.runs.map(mapBackendRunToDashboardRun);
        const liveIds = new Set(liveMapped.map((r: any) => r.id));
        const rest = RUNS_DATA.filter((r) => !liveIds.has(r.id));
        setRuns([...liveMapped, ...rest]);
      }
      setEngineConnected(Boolean(data.engineConnected));
    } catch {
      setEngineConnected(false);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLiveRuns();
    const interval = setInterval(fetchLiveRuns, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCopyPrompt = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleTriggerAudit = async () => {
    setIsAuditing(true);
    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feat/quick-checkout",
          sha: "f1e2d3c" + Math.random().toString(16).slice(2, 6),
          scope: "changed",
          test_type: "functional",
        }),
      });
      await fetchLiveRuns();
    } catch {
      // ignore
    } finally {
      setIsAuditing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased selection:bg-slate-200">
      {/* Structural background graph grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light mask-radial-light opacity-60" />

      {/* 1. Global Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Brand & Repo Context */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="h-7 w-7 rounded-lg bg-slate-950 text-white font-mono font-bold text-xs flex items-center justify-center shadow-xs group-hover:bg-slate-800 transition-colors">
                PR
              </div>
              <span className="font-bold text-slate-950 text-sm tracking-tight hidden sm:inline-block">
                AutoQA Platform
              </span>
            </Link>

            <span className="text-slate-300">/</span>

            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">
              <GitBranch className="h-3.5 w-3.5 text-slate-500" />
              <span>acme-corp / ecommerce-web</span>
              <span className="rounded bg-slate-200/80 px-1 py-0.2 text-[10px] font-mono text-slate-600">
                HEAD: f1e2d3c
              </span>
            </div>

            {/* Navigation Links */}
            <nav className="hidden md:flex items-center gap-1 border-l border-slate-200 pl-3">
              <Link
                href="/dashboard"
                className="rounded-md px-2.5 py-1 text-xs font-bold text-slate-950 bg-slate-100 transition-colors"
              >
                Overview
              </Link>
              <Link
                href="/dashboard/runs"
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                PR Forensics
              </Link>
              <Link
                href="/dashboard/projects"
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Projects & Settings
              </Link>
            </nav>
          </div>

          {/* Account Profile & Sign Out */}
          <div className="flex items-center gap-3">
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

      {/* Main Container */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* =========================================================================
            TIER 1: PLATFORM / FLEET-LEVEL SIGNALS STRIP
            ========================================================================= */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2.5 mb-3">
            <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px] text-slate-500">
              Platform &amp; Fleet State
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${engineConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
                <span className={`font-mono text-[11px] ${engineConnected ? "text-emerald-700" : "text-amber-700"} font-semibold`}>
                  {engineConnected ? "PR Testing Engine Live (localhost:8000)" : "PR Testing Engine: Standby"}
                </span>
              </div>
              <button
                onClick={() => fetchLiveRuns()}
                className="text-[10px] text-slate-500 hover:text-slate-800 flex items-center gap-1 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                title="Refresh runs"
              >
                <RefreshCw className={`h-2.5 w-2.5 ${isRefreshing ? "animate-spin" : ""}`} />
                <span>Sync</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-400 block text-[10px] font-sans">Concurrent Sandboxes</span>
              <div className="font-bold text-slate-900 text-sm mt-0.5 flex items-center gap-1.5">
                <span>1 Running / 0 Queued</span>
              </div>
              <span className="text-[11px] text-emerald-600 font-sans">Pool: 3 Healthy</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] font-sans">Aggregate Pass / Flake</span>
              <div className="font-bold text-slate-900 text-sm mt-0.5">
                91.2% <span className="text-slate-400 font-normal">/ 2.1% Flake</span>
              </div>
              <span className="text-[11px] text-slate-500 font-sans">Trending stable (30d)</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] font-sans">Resource &amp; Cost Signals</span>
              <div className="font-bold text-slate-900 text-sm mt-0.5">14 LLM Calls</div>
              <span className="text-[11px] text-slate-500 font-sans">4.2 sandbox mins today</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] font-sans">GitHub App Connection</span>
              <div className="font-bold text-emerald-700 text-sm mt-0.5 flex items-center gap-1 font-sans">
                <Check className="h-3.5 w-3.5" />
                <span>Check Runs Active</span>
              </div>
              <span className="text-[11px] text-slate-500 font-sans">Installation #981247</span>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TIER 2: PER-REPO / PROJECT CONFIG & FRESHNESS CACHE
            ========================================================================= */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px] text-slate-500">
                Repository Configuration &amp; Flow Coverage
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-700 border border-slate-200">
                acme-corp/ecommerce-web
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold">
                HEAD (f1e2d3c): TESTED (Cached)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Sandbox Config Defaults */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 space-y-1">
              <span className="text-slate-500 text-[11px] font-medium">Sandbox Defaults:</span>
              <div className="font-semibold text-slate-900">
                Scope: <code className="font-mono bg-white px-1 py-0.2 rounded border border-slate-200">changed</code>
              </div>
              <div className="font-semibold text-slate-900">
                Type: <code className="font-mono bg-white px-1 py-0.2 rounded border border-slate-200">functional+visual</code>
              </div>
            </div>

            {/* Seeded Flow Library Size vs Agent-Generated */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 space-y-1">
              <span className="text-slate-500 text-[11px] font-medium">Flow Library Coverage:</span>
              <div className="font-bold text-slate-900">
                4 Seeded Critical Flows
              </div>
              <div className="text-[11px] text-slate-500">
                + 12 agent-generated journeys
              </div>
            </div>

            {/* Credential / Test Account Status */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 space-y-1">
              <span className="text-slate-500 text-[11px] font-medium">Credential Status:</span>
              <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Configured: YES</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Roles: <span className="font-mono text-slate-700">standard_qa, billing_admin</span>
              </div>
            </div>

            {/* Freshness / Cache State */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 space-y-1">
              <span className="text-slate-500 text-[11px] font-medium">Branch Freshness:</span>
              <div className="font-mono font-bold text-slate-900">
                feat/quick-checkout
              </div>
              <div className="text-[11px] text-emerald-700 font-semibold">
                SHA dedup hit • 0ms cold boot
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TIER 3: PER-RUN PIPELINE INSPECTOR (MASTER-DETAIL)
            ========================================================================= */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider text-[11px] text-slate-500">
                Per-Run Verification Pipeline &amp; Results
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Forensics from Journey Planner + Result Packaging for branch commits.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => setIsExternalModalOpen(true)}
                variant="outline"
                className="border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/70 text-indigo-700 text-xs font-semibold h-8 shadow-xs gap-1.5"
              >
                <Globe className="h-3.5 w-3.5 text-indigo-600" />
                <span>Verify External Site</span>
              </Button>
              <Button
                onClick={handleTriggerAudit}
                disabled={isAuditing}
                className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 shadow-xs gap-1.5"
              >
                {isAuditing ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    <span>Executing Pipeline…</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    <span>Trigger Verification</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Master Detail Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left: Runs Selector (4 cols) */}
            <div className="lg:col-span-4 divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {runs.map((run) => {
                const isSelected = run.id === selectedRun.id;
                return (
                  <div
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected ? "bg-slate-100/90 border-l-3 border-slate-950" : "hover:bg-slate-50/70"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-slate-900 truncate">
                        {run.branch}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {run.timestamp}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mb-1.5">
                      {run.status === "failed" ? (
                        <span className="rounded bg-rose-50 border border-rose-200 text-rose-700 px-1.5 py-0.2 text-[10px] font-bold">
                          FAILED
                        </span>
                      ) : run.status === "running" ? (
                        <span className="rounded bg-sky-50 border border-sky-200 text-sky-700 px-1.5 py-0.2 text-[10px] font-bold animate-pulse">
                          RUNNING
                        </span>
                      ) : run.status === "queued" ? (
                        <span className="rounded bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.2 text-[10px] font-bold">
                          QUEUED
                        </span>
                      ) : run.status === "superseded" ? (
                        <span className="rounded bg-slate-100 border border-slate-300 text-slate-500 px-1.5 py-0.2 text-[10px] font-bold">
                          SUPERSEDED
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.2 text-[10px] font-bold">
                          PASSED
                        </span>
                      )}

                      <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[10px] font-mono text-slate-600">
                        {run.triggerType}
                      </span>

                      <span className="text-[11px] font-mono text-slate-500">
                        {run.duration}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono flex items-center justify-between">
                      <span>{run.sha} • {run.triggeringUser}</span>
                      {run.prNumber && <span className="font-semibold text-slate-800">PR #{run.prNumber}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right: Selected Run Detail (8 cols) */}
            <div className="lg:col-span-8 p-5 space-y-5 bg-white">
              {/* Header Overview */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-slate-900">
                      {selectedRun.id}
                    </span>
                    <span>•</span>
                    <span className="font-mono text-xs text-slate-500">{selectedRun.sha}</span>
                    {selectedRun.prNumber && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-bold text-slate-700">
                        PR #{selectedRun.prNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    Trigger: <span className="text-slate-800 font-semibold">{selectedRun.triggerType}</span> by{" "}
                    <span className="text-slate-800 font-semibold">{selectedRun.triggeringUser}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-700">
                    Scope: {selectedRun.scope}
                  </span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-700">
                    Type: {selectedRun.testType}
                  </span>
                </div>
              </div>

              {/* Risk Tag & Diff/Intent Rationale */}
              <div
                className={`rounded-lg border p-3 text-xs space-y-1 ${
                  selectedRun.risk === "High"
                    ? "border-rose-200 bg-rose-50/60 text-rose-900"
                    : "border-slate-200 bg-slate-50/60 text-slate-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider ${
                      selectedRun.risk === "High" ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-800"
                    }`}
                  >
                    Risk: {selectedRun.risk}
                  </span>
                  <span className="font-semibold text-slate-900">Diff / Intent Analyzer Rationale:</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-700">
                  {selectedRun.riskRationale}
                </p>
              </div>

              {/* Bucket Counts & Baseline Comparison Result */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Bucket Counts */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                  <span className="font-semibold text-slate-900 text-[11px] block uppercase tracking-wider text-slate-500">
                    Result Bucket Counts
                  </span>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-emerald-700 font-bold">
                      ✓ {selectedRun.bucketCounts.passed} Passed
                    </span>
                    {selectedRun.bucketCounts.failed > 0 && (
                      <span className="text-rose-700 font-bold">
                        ✗ {selectedRun.bucketCounts.failed} Failed
                      </span>
                    )}
                    <span className="text-slate-600">
                      ℹ {selectedRun.bucketCounts.additionalFindings} Findings
                    </span>
                  </div>
                  {selectedRun.additionalFindingsDetails && (
                    <ul className="text-[10px] text-slate-500 list-disc pl-4 space-y-0.5">
                      {selectedRun.additionalFindingsDetails.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Baseline Comparison Result */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-1.5">
                  <span className="font-semibold text-slate-900 text-[11px] block uppercase tracking-wider text-slate-500">
                    Baseline Comparison (vs main)
                  </span>
                  <div className="flex items-center gap-1.5">
                    {selectedRun.baselineComparison.isNewRegression ? (
                      <span className="rounded bg-rose-100 text-rose-800 border border-rose-200 px-1.5 py-0.2 text-[10px] font-bold">
                        NEW REGRESSION
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 text-[10px] font-bold">
                        MATCHES BASELINE
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-slate-500">
                      main @ {selectedRun.baselineComparison.mainSha}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {selectedRun.baselineComparison.details}
                  </p>
                </div>
              </div>

              {/* Forensic Artifacts Strip */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                <span className="font-semibold text-slate-900 text-xs block">
                  Forensic Proof Artifacts
                </span>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  {selectedRun.artifacts.traceUrl ? (
                    <a
                      href={selectedRun.artifacts.traceUrl}
                      download
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 text-slate-700"
                    >
                      <Download className="h-3 w-3 text-slate-500" />
                      <span>trace.zip</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-400 cursor-not-allowed">
                      <Download className="h-3 w-3 text-slate-300" />
                      <span>trace.zip</span>
                    </span>
                  )}

                  {selectedRun.artifacts.videoUrl ? (
                    <a
                      href={selectedRun.artifacts.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 text-slate-700"
                    >
                      <Video className="h-3 w-3 text-slate-500" />
                      <span>video.webm</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-400 cursor-not-allowed">
                      <Video className="h-3 w-3 text-slate-300" />
                      <span>video.webm</span>
                    </span>
                  )}

                  {selectedRun.artifacts.screenshotUrl && (
                    <a
                      href={selectedRun.artifacts.screenshotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 text-rose-800 font-semibold"
                    >
                      <Camera className="h-3 w-3 text-rose-600" />
                      <span>screenshot.png</span>
                    </a>
                  )}

                  <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
                    <Eye className="h-3 w-3 text-slate-500" />
                    <span>DOM Snapshot: Available</span>
                  </span>

                  <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
                    <Network className="h-3 w-3 text-slate-500" />
                    <span>{selectedRun.artifacts.networkWaterfallCount} Network Waterfall Events</span>
                  </span>
                </div>
              </div>

              {/* Timing Breakdown SLA if available */}
              {selectedRun.timing && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs font-mono">
                  <span className="text-slate-500 font-sans font-semibold">Runtime SLA:</span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-slate-700">Analysis: <strong className="text-slate-900">{selectedRun.timing.analysis_duration_s?.toFixed(2) ?? "0.00"}s</strong></span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-700">Journeys: <strong className="text-slate-900">{selectedRun.timing.journeys_duration_s?.toFixed(2) ?? "0.00"}s</strong></span>
                    <span className="text-slate-300">•</span>
                    <span className="text-emerald-700 font-bold">Total: {selectedRun.timing.total_duration_s?.toFixed(2) ?? "0.00"}s</span>
                  </div>
                </div>
              )}

              {/* Session Video Player */}
              {selectedRun.artifacts.videoUrl && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-900 text-xs block">
                    Session Video
                  </span>
                  <CustomVideoPlayer
                    src={selectedRun.artifacts.videoUrl}
                    className="max-h-[320px]"
                  />
                </div>
              )}

              {/* Annotated Failure Screenshot, when available */}
              {selectedRun.artifacts.screenshotUrl && (
                <div className="rounded-lg border border-rose-300 bg-rose-50/40 overflow-hidden shadow-sm">
                  <div className="bg-rose-100/80 border-b border-rose-200 px-3 py-1.5 text-[11px] font-semibold text-rose-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-rose-600" />
                      Annotated Failure Defect (Bounding Box & Callouts)
                    </span>
                    <a
                      href={selectedRun.artifacts.screenshotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-rose-700 hover:underline text-[10px] font-mono"
                    >
                      View Full Image ↗
                    </a>
                  </div>
                  <div className="p-2 bg-slate-950 flex justify-center">
                    <img
                      src={selectedRun.artifacts.screenshotUrl}
                      alt="Annotated Failure Screenshot"
                      className="max-h-[240px] object-contain rounded border border-slate-800"
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
                <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-rose-900 flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5 text-rose-600" />
                      Remediation Prompt (Ready to paste into Claude Code / Cursor)
                    </span>
                    <button
                      onClick={() => handleCopyPrompt(selectedRun.remediationPrompt!)}
                      className="inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-900 hover:bg-rose-50"
                    >
                      {copiedPrompt ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedPrompt ? "Copied" : "Copy Prompt"}</span>
                    </button>
                  </div>

                  <pre className="p-3 rounded border border-rose-200 bg-white font-mono text-[11px] text-rose-800 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                    {selectedRun.remediationPrompt}
                  </pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* =========================================================================
            TIER 4: PER-USER ACTIVE SESSIONS & IN-FLIGHT INTENTS
            ========================================================================= */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-950 text-sm">
                Per-User In-Flight Intent Stream
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Live stream from Coding Agent Bridge daemon: &quot;What&apos;s being changed and why&quot; right now.
              </p>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 border border-slate-200">
              Active User: {userEmail}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {IN_FLIGHT_INTENTS.map((intent) => (
              <div
                key={intent.id}
                className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 space-y-2 text-xs font-mono"
              >
                <div className="flex items-center justify-between text-[11px] font-sans">
                  <span className="font-bold text-slate-900">{intent.branch}</span>
                  <span className="text-slate-400">{intent.time}</span>
                </div>

                <div className="text-slate-700">
                  <span className="text-slate-400">File: </span>
                  <span className="font-bold text-slate-900">{intent.fileModified}</span>
                </div>

                <div className="text-slate-600 text-[11px] font-sans">
                  <span className="font-semibold text-slate-800">Prompt: </span>
                  &quot;{intent.prompt}&quot;
                </div>

                <div className="text-slate-500 text-[10px] font-sans">
                  <span className="font-semibold text-slate-700">Inferred: </span>
                  {intent.inferredIntent}
                </div>

                <div className="pt-1 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">{intent.user}</span>
                  {intent.status === "in-flight" ? (
                    <span className="rounded bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.2 font-bold">
                      IN-FLIGHT
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 font-bold">
                      VERIFIED
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <ExternalTestModal
        isOpen={isExternalModalOpen}
        onClose={() => setIsExternalModalOpen(false)}
        onSuccess={() => fetchLiveRuns()}
      />
    </div>
  );
}
