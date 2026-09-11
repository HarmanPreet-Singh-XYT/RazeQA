"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Compass,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Layers,
  Lock,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Video,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import { logout } from "@/app/login/actions";

export default function JobAnalyticsClient({
  runId,
  userEmail,
}: {
  runId: string;
  userEmail: string;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [appliedFix, setAppliedFix] = useState(false);
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [applyFixError, setApplyFixError] = useState<string | null>(null);

  const fetchJobAnalytics = async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/analytics`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setFetchError(null);
        const paths = Object.keys(json.quality_report?.per_path_analysis || {});
        if (paths.length > 0) {
          setSelectedPath(paths[0]);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setFetchError(errData.error || `Could not load quality report (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setFetchError(err?.message || "Failed to reach PR Testing Engine.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobAnalytics();
  }, [runId]);

  const handleApplyFix = async () => {
    setIsApplyingFix(true);
    setApplyFixError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/apply`, {
        method: "POST",
      });
      if (res.ok) {
        setAppliedFix(true);
        setTimeout(() => setAppliedFix(false), 4000);
        await fetchJobAnalytics();
      } else {
        const errData = await res.json().catch(() => ({}));
        setApplyFixError(errData.error || `Failed to apply fix (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setApplyFixError(err?.message || "Network error while connecting to PR Testing Engine.");
    } finally {
      setIsApplyingFix(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf9] flex flex-col items-center justify-center p-6 text-center">
        <div className="flex items-center gap-2 text-slate-600 text-xs font-medium">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
          <span>Loading quality diagnostics for {runId}...</span>
        </div>
      </div>
    );
  }

  const report = data?.quality_report;

  if (!report) {
    return (
      <div className="min-h-screen bg-[#fafaf9] flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Job Analytics Unavailable</h2>
          <p className="text-xs text-slate-600">
            {fetchError || `Could not find forensic quality report for run "${runId}". Ensure the backend service is active.`}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => {
                setLoading(true);
                fetchJobAnalytics();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
            <Link
              href="/dashboard/runs"
              className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Back to PR Forensics
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isExternal = report.mode === "external_site";
  const perPathMap = report.per_path_analysis || {};
  const pathKeys = Object.keys(perPathMap);
  const activePathData = perPathMap[selectedPath] || (pathKeys.length > 0 ? perPathMap[pathKeys[0]] : null);

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased selection:bg-indigo-100">
      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-50" />

      {/* Global Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
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

            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">
              <Compass className="h-3.5 w-3.5 text-indigo-600" />
              <span>Job Analytics</span>
              <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] font-mono text-slate-700">
                {runId}
              </span>
            </div>

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
              <Link
                href="/dashboard/analytics"
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Fleet Analytics
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="h-6 w-6 rounded-full bg-slate-900 text-white font-bold text-[10px] flex items-center justify-center">
                QA
              </div>
              <span className="text-xs font-medium text-slate-700 hidden lg:inline-block">
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
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8 space-y-8">
        {/* Job Header Strip */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <Link
                  href="/dashboard/runs"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Forensics
                </Link>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-xs font-bold text-slate-900">
                  {runId}
                </span>

                {/* Operational Mode Badge */}
                {isExternal ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-700 border border-sky-200">
                    <Globe className="h-3.5 w-3.5" />
                    External Site (Zero Code Access)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-700 border border-purple-200">
                    <Code2 className="h-3.5 w-3.5" />
                    GitHub PR (Full Code Access)
                  </span>
                )}
              </div>

              <h1 className="text-xl font-extrabold text-slate-950 tracking-tight flex items-center gap-2">
                <span>{data?.branch || "Job Quality Audit"}</span>
                <span className="text-sm font-normal text-slate-400 font-mono">
                  ({data?.sha?.slice(0, 12) || "commit-sha"})
                </span>
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-slate-500 font-medium">Composite Score</div>
                <div className="text-2xl font-black text-slate-950">
                  {report.composite_health_index}/100
                </div>
              </div>
              <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 font-mono font-bold text-sm flex items-center justify-center">
                Q8
              </div>
            </div>
          </div>

          {/* 8-Dimension Overview for this job */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-1">
            {Object.entries(report.dimensions || {}).map(([dim, score]: any) => (
              <div
                key={dim}
                className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-center space-y-1"
              >
                <div className="text-[10px] font-semibold text-slate-500 capitalize truncate">
                  {dim}
                </div>
                <div className="text-base font-bold text-slate-900 font-mono">
                  {score}
                </div>
                <div className="h-1 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      score >= 90 ? "bg-emerald-500" : score >= 80 ? "bg-indigo-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* =========================================================================
            PER-PATH QUALITY ANALYSIS & INTERACTIVE EXPLORER
            ========================================================================= */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-950 tracking-tight">
                Per-Path Analysis & Quality Scorecard
              </h2>
              <p className="text-xs text-slate-500">
                Isolated evaluation for each tested route across Performance, Usability, i18n, Security, and SEO.
              </p>
            </div>

            {/* Path Selector Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {pathKeys.map((p) => {
                const isSelected = p === selectedPath;
                const pathScore = perPathMap[p]?.composite_score || 85;
                return (
                  <button
                    key={p}
                    onClick={() => setSelectedPath(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium font-mono transition-all flex items-center gap-2 shrink-0 ${
                      isSelected
                        ? "bg-slate-950 text-white shadow-xs"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>{p}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : pathScore >= 90
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {pathScore}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {activePathData ? (
            <div className="space-y-6 animate-in fade-in-50">
              {/* Path Scorecards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">Performance</div>
                  <div className="text-xl font-black text-slate-900">{activePathData.performance_score}</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {activePathData.latency_ms}ms • {activePathData.transfer_size_kb}KB
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">Usability & A11y</div>
                  <div className="text-xl font-black text-slate-900">{activePathData.usability_score}</div>
                  <div className="text-[10px] text-slate-500">
                    {activePathData.missing_aria_count} missing aria labels
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">i18n & RTL</div>
                  <div className="text-xl font-black text-slate-900">{activePathData.i18n_score}</div>
                  <div className="text-[10px] text-slate-500">
                    {activePathData.rtl_supported ? "✓ RTL Ready" : "⚠ No RTL support"}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">Security</div>
                  <div className="text-xl font-black text-slate-900">{activePathData.security_score}</div>
                  <div className="text-[10px] text-slate-500">
                    {activePathData.missing_headers?.length || 0} missing headers
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">SEO & Meta</div>
                  <div className="text-xl font-black text-slate-900">{activePathData.seo_score}</div>
                  <div className="text-[10px] text-slate-500">
                    {activePathData.h1_count === 1 ? "✓ 1 h1" : "⚠ Invalid h1"}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">Reliability</div>
                  <div className="text-xl font-black text-slate-900">{activePathData.reliability_score}</div>
                  <div className="text-[10px] text-slate-500">
                    {activePathData.js_errors?.length || 0} JS exceptions
                  </div>
                </div>
              </div>

              {/* Concrete Diagnostics & Audit Table for this path */}
              <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-3">
                <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                  <span className="font-bold text-slate-900">
                    Path Diagnostic Log: <code className="text-indigo-600 font-mono">{activePathData.path}</code>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {activePathData.request_count} HTTP requests • {activePathData.dom_node_count} DOM nodes
                  </span>
                </div>

                <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="font-semibold text-slate-900">AI Path Summary: </span>
                  {activePathData.ai_summary}
                </div>

                {activePathData.remediation_suggestion && (
                  <div className="text-xs text-slate-800 bg-amber-50/60 p-3 rounded-lg border border-amber-200 flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-amber-900">Targeted Recommendation: </span>
                      {activePathData.remediation_suggestion}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-slate-500">
              Select a path above to inspect its granular quality dimensions.
            </div>
          )}
        </section>

        {/* =========================================================================
            TAILORED REMEDIATION SECTION (Code Patches vs Server Advisories)
            ========================================================================= */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-950 tracking-tight flex items-center gap-2">
                <Workflow className="h-4 w-4 text-indigo-600" />
                {isExternal ? "Server / Edge Advisory" : "Apply Synthesized Patch to PR"}
              </h2>
              <p className="text-xs text-slate-500">
                {isExternal
                  ? "Over-the-wire server and CDN configuration guidance for this live external endpoint."
                  : "Synthesized code patch ready to be applied directly to the pull request branch."}
              </p>
            </div>

            {!isExternal && (
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={handleApplyFix}
                  disabled={isApplyingFix}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-xs disabled:opacity-60"
                >
                  {isApplyingFix ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : appliedFix ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <GitPullRequest className="h-3.5 w-3.5" />
                  )}
                  {isApplyingFix
                    ? "Applying Patch to PR..."
                    : appliedFix
                    ? "Patch Committed to Branch!"
                    : "Apply Fix to PR"}
                </button>
                {applyFixError && (
                  <span className="text-[11px] text-red-600 font-medium">
                    {applyFixError}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {report.remediations && report.remediations.length > 0 ? (
              report.remediations.map((rem: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-4 bg-slate-50/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{rem.title}</span>
                    <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                      Target: {rem.target}
                    </span>
                  </div>
                  <pre className="rounded-lg bg-slate-950 p-3 text-[11px] font-mono text-slate-100 overflow-x-auto whitespace-pre">
                    {rem.patch || rem.instructions}
                  </pre>
                </div>
              ))
            ) : (
              <div className="text-xs text-slate-500 py-3">
                No critical defects detected. All evaluated quality benchmarks pass benchmark standards.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
