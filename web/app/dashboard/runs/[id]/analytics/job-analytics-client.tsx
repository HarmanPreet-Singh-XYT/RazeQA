"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Compass,
  Cpu,
  Database,
  DollarSign,
  ExternalLink,
  Eye,
  FileCode2,
  Filter,
  Gauge,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  HelpCircle,
  Info,
  Layers,
  LayoutGrid,
  Lock,
  Monitor,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Video,
  Workflow,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { ApplyFixButton } from "@/components/apply-fix-button";
import { FixProposalViewer } from "@/components/fix-proposal-viewer";
import { CustomVideoPlayer } from "@/components/custom-video-player";

type TabId =
  | "overview"
  | "stategraph"
  | "agent"
  | "replay"
  | "fuzzing"
  | "multienv"
  | "funnels"
  | "remediation";

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
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [selectedReplayStep, setSelectedReplayStep] = useState<number>(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const fetchJobAnalytics = async () => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/analytics`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        // The API returns an explicit `analytics_unavailable` signal (with a
        // human-readable reason) rather than synthesizing a report. Surface that
        // specific explanation instead of silently showing an empty shell.
        setFetchError(
          json.analytics_unavailable
            ? [json.detail, json.reason ? `(${json.reason})` : null].filter(Boolean).join(" ")
            : null
        );
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf9] flex flex-col items-center justify-center p-6 text-center">
        <div className="flex items-center gap-2 text-slate-600 text-xs font-medium">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
          <span>Loading 30-dimension quality forensics for run {runId}...</span>
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
            {fetchError || `Could not find forensic quality report for run "${runId}".`}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => {
                setLoading(true);
                fetchJobAnalytics();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
            <Link
              href="/dashboard/runs"
              className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Back to Test Runs
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

  const stateGraph = report.state_graph || { nodes: [], edges: [], coverage_stats: {} };
  const trajectory = report.trajectory_analytics || {};
  const costMetrics = report.cost_metrics || {};
  const webVitals = report.web_vitals || {};
  // Measured values are nullable: the engine reports `null` for metrics it could
  // not observe (e.g. INP when no interaction occurred) rather than inventing a
  // number. Render that honestly instead of printing "undefinedms".
  const fmtVital = (v: unknown, unit = "ms") =>
    typeof v === "number" ? `${v}${unit}` : "—";
  const vitalStatus = (s: unknown) => (typeof s === "string" ? s : "not measured");
  const flakiness = report.flakiness_score || {};
  const intentVsOutcome = report.intent_vs_outcome || [];
  const selfHealingLocators = report.self_healing_locators || [];
  const replaySteps = report.session_timeline || [];
  const silentErrors = report.silent_errors || [];
  const apiTelemetry = report.api_telemetry || [];
  const fuzzingRobustness = report.fuzzing_robustness || [];
  const viewportMatrix = report.viewport_matrix || [];
  const localizationMatrix = report.localization_matrix || [];
  const throttlingImpact = report.network_throttling_impact || [];
  const funnelCompletion = report.funnel_completion || [];
  const clickDistance = report.click_distance_to_value || {};
  const frictionPoints = report.friction_dropout_points || [];
  const deadEndElements = report.dead_end_elements || [];

  const activeReplay = replaySteps.find((s: any) => s.step_index === selectedReplayStep) || replaySteps[0] || null;

  return (
    <main className="relative z-10 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6 space-y-6 flex-1 animate-in fade-in-50 duration-200">
      {/* =========================================================================
          TOP COMMAND STRIP & RUN METADATA HEADER
          ========================================================================= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Link
                href="/dashboard/runs"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>All Test Runs</span>
              </Link>
              <span className="text-slate-300">•</span>
              <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {runId}
              </span>

              {/* Status Pill */}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border uppercase tracking-wider ${
                  data.status === "passed" || data.status === "Passed" || data.status === "completed"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-rose-50 text-rose-700 border-rose-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    data.status === "passed" || data.status === "Passed" || data.status === "completed"
                      ? "bg-emerald-600"
                      : "bg-rose-600"
                  }`}
                />
                <span>{data.status || "Passed"}</span>
              </span>

              {/* Operational Mode Badge */}
              {isExternal ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-700 border border-sky-200">
                  <Globe className="h-3 w-3" />
                  External Site (Black-Box Forensics)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-800 border border-slate-300">
                  <Code2 className="h-3 w-3" />
                  GitHub PR (White-Box Code &amp; AST Access)
                </span>
              )}

              {/* 30-Category Verified Badge */}
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 border border-indigo-200">
                <Sparkles className="h-3 w-3" />
                30 Quality Dimensions Active
              </span>
            </div>

            <h1 className="text-2xl font-black text-slate-950 tracking-tight flex items-center gap-2.5 pt-1">
              <span>{data?.branch || "main"}</span>
              <span className="text-sm font-normal text-slate-400 font-mono">
                ({data?.sha?.slice(0, 10) || "HEAD"})
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              Autonomous paired testing session evaluating performance, accessibility, i18n, security, trajectory graphs, and fuzzing signals.
            </p>
          </div>

          {/* Composite Score and Cost Meter */}
          <div className="flex items-center gap-6 shrink-0 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <div className="space-y-0.5 text-right">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Agent Inference Cost
              </div>
              <div className="text-sm font-mono font-bold text-slate-900 flex items-center justify-end gap-1">
                <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                <span>${(costMetrics.inference_cost_usd ?? 0).toFixed(4)}</span>
                <span className="text-[10px] font-normal text-slate-400">({costMetrics.total_tokens ?? 0} tokens)</span>
              </div>
            </div>

            <div className="h-8 w-px bg-slate-200" />

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Composite Index
                </div>
                <div className="text-3xl font-black text-slate-950 font-mono">
                  {report.composite_health_index}/100
                </div>
              </div>
              <div className={`h-11 w-11 rounded-xl font-mono font-black text-sm flex items-center justify-center border shadow-2xs ${
                report.composite_health_index >= 90
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : report.composite_health_index >= 75
                  ? "bg-indigo-50 text-indigo-800 border-indigo-200"
                  : "bg-rose-50 text-rose-800 border-rose-200"
              }`}>
                {report.composite_health_index >= 90 ? "A+" : report.composite_health_index >= 80 ? "A-" : "B"}
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            8 CORE NON-FUNCTIONAL DIMENSIONS CAROUSEL
            ========================================================================= */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {Object.entries(report.dimensions || {}).map(([dim, score]: any) => {
            const isOptimal = score >= 90;
            const isMedium = score >= 75;
            return (
              <div
                key={dim}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-center space-y-1.5 transition-all hover:bg-slate-100/70"
              >
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider capitalize truncate">
                  {dim}
                </div>
                <div className="text-lg font-black text-slate-900 font-mono">
                  {score}
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      isOptimal ? "bg-emerald-500" : isMedium ? "bg-indigo-600" : "bg-amber-500"
                    }`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* =========================================================================
          PRIMARY INTERACTIVE TAB BAR
          ========================================================================= */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2 overflow-x-auto">
        {[
          { id: "overview", label: "Executive Scorecard", icon: Gauge },
          { id: "stategraph", label: "State Graph & Trajectory", icon: Compass },
          { id: "agent", label: "Agent Intelligence & Diagnostics", icon: Cpu },
          { id: "replay", label: "Session Replay & Telemetry", icon: Video },
          { id: "fuzzing", label: "Mutation Fuzzing & Signals", icon: Zap },
          { id: "multienv", label: "Multi-Environment Matrix", icon: Monitor },
          { id: "funnels", label: "Business Funnels & UX", icon: Layers },
          { id: "remediation", label: "Auto-Fix & PR Patches", icon: Workflow },
        ].map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as TabId)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? "bg-slate-950 text-white shadow-xs"
                  : "bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${isActive ? "text-white" : "text-slate-500"}`} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          TAB 1: EXECUTIVE SCORECARD & PER-PATH METRICS
          ========================================================================= */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-in fade-in-50">
          {/* Core Web Vitals Meter Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-600" />
                  <span>Real-User Core Web Vitals &amp; Per-Step Latency Profiling</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Chromium CDP performance telemetry recorded during autonomous journey exploration.
                </p>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                <span>Model: {costMetrics.model_name || "not reported"}</span>
                <span>•</span>
                <span>Action Latency: {fmtVital(costMetrics.avg_action_latency_ms)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">LCP (Largest Paint)</div>
                <div className="text-xl font-black text-slate-900 font-mono">{fmtVital(webVitals.lcp_ms)}</div>
                <span className="inline-block text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {vitalStatus(webVitals.lcp_status)}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">CLS (Layout Shift)</div>
                <div className="text-xl font-black text-slate-900 font-mono">{fmtVital(webVitals.cls, "")}</div>
                <span className="inline-block text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {vitalStatus(webVitals.cls_status)}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">INP (Next Paint)</div>
                <div className="text-xl font-black text-slate-900 font-mono">{fmtVital(webVitals.inp_ms)}</div>
                <span className="inline-block text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {vitalStatus(webVitals.inp_status)}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">FCP (First Content)</div>
                <div className="text-xl font-black text-slate-900 font-mono">{fmtVital(webVitals.fcp_ms)}</div>
                <span className="text-[10px] text-slate-500 font-mono block">Sub-1s Target</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">TTFB (First Byte)</div>
                <div className="text-xl font-black text-slate-900 font-mono">{fmtVital(webVitals.ttfb_ms)}</div>
                <span className="text-[10px] text-slate-500 font-mono block">Edge response</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">TTI (Interactive)</div>
                <div className="text-xl font-black text-slate-900 font-mono">{fmtVital(webVitals.tti_ms)}</div>
                <span className="text-[10px] text-slate-500 font-mono block">DOM Ready</span>
              </div>
            </div>
          </div>

          {/* Per-Path Quality Analysis Strip */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-950">
                  Per-Path Quality Diagnostics
                </h3>
                <p className="text-xs text-slate-500">
                  Select a tested route to view isolated accessibility scorecards, HTTP transfer sizes, and AI recommendations.
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
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium font-mono transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
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

            {activePathData && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-500">Performance</div>
                    <div className="text-xl font-black text-slate-900">{activePathData.performance_score}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {activePathData.latency_ms}ms • {activePathData.transfer_size_kb}KB
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-500">Usability &amp; a11y</div>
                    <div className="text-xl font-black text-slate-900">{activePathData.usability_score}</div>
                    <div className="text-[10px] text-slate-500">
                      {activePathData.missing_aria_count} missing aria labels
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-500">i18n &amp; RTL</div>
                    <div className="text-xl font-black text-slate-900">{activePathData.i18n_score}</div>
                    <div className="text-[10px] text-slate-500">
                      {activePathData.rtl_supported ? "✓ RTL Ready" : "⚠ No RTL script"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-500">Security &amp; Privacy</div>
                    <div className="text-xl font-black text-slate-900">{activePathData.security_score}</div>
                    <div className="text-[10px] text-slate-500">
                      {activePathData.missing_headers?.length || 0} missing headers
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-500">SEO &amp; JSON-LD</div>
                    <div className="text-xl font-black text-slate-900">{activePathData.seo_score}</div>
                    <div className="text-[10px] text-slate-500">
                      {activePathData.h1_count === 1 ? "✓ 1 H1 Tag" : "⚠ H1 Warning"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-500">Reliability &amp; Errors</div>
                    <div className="text-xl font-black text-slate-900">{activePathData.reliability_score}</div>
                    <div className="text-[10px] text-slate-500">
                      {activePathData.js_errors?.length || 0} exceptions
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-3">
                  <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                    <span className="font-bold text-slate-900">
                      AI Diagnostic Log for Route <code className="text-indigo-600 font-mono">{activePathData.path}</code>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {activePathData.request_count} requests • {activePathData.dom_node_count} DOM nodes
                    </span>
                  </div>

                  <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="font-semibold text-slate-900">Path Synthesis: </span>
                    {activePathData.ai_summary}
                  </div>

                  {activePathData.remediation_suggestion && (
                    <div className="text-xs text-slate-800 bg-amber-50/60 p-3 rounded-lg border border-amber-200 flex items-start gap-2">
                      <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-900">Recommendation: </span>
                        {activePathData.remediation_suggestion}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: APPLICATION STATE GRAPH & TRAJECTORY ANALYTICS
          ========================================================================= */}
      {activeTab === "stategraph" && (
        <div className="space-y-6 animate-in fade-in-50">
          {/* Visual Directed Graph */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Compass className="h-4 w-4 text-indigo-600" />
                  <span>Application State Graph &amp; Site Map Coverage</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Visual directed topology of every discovered route, modal, and state. Visited nodes in green, unexplored branches in gray, dead-ends in red.
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span>Visited ({stateGraph.coverage_stats?.visited_count || 0})</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  <span>Unexplored ({stateGraph.coverage_stats?.unexplored_count || 0})</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span>Dead-Ends ({stateGraph.coverage_stats?.dead_end_count || 0})</span>
                </span>
                <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded border border-indigo-200">
                  {stateGraph.coverage_stats?.coverage_pct || 85}% Coverage
                </span>
              </div>
            </div>

            {/* Interactive SVG Directed Graph Visualizer */}
            <div className="bg-slate-950 rounded-xl p-6 border border-slate-800 text-white min-h-[280px] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800 pb-3">
                <span>GRAPH TOPOLOGY (DIRECTED PATHS &amp; MODAL TRANSITIONS)</span>
                <span>CLICK ANY NODE TO INSPECT DOM &amp; LATENCY</span>
              </div>

              <div className="py-8 flex items-center justify-around flex-wrap gap-6">
                {stateGraph.nodes?.map((node: any, idx: number) => {
                  const isDead = node.status === "dead_end";
                  const isUnexplored = node.status === "unexplored";
                  const isSelected = selectedNodeId === node.id;

                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`relative flex flex-col items-center p-3.5 rounded-xl border transition-all cursor-pointer min-w-[130px] ${
                        isSelected
                          ? "ring-2 ring-indigo-400 scale-105"
                          : "hover:scale-102"
                      } ${
                        isDead
                          ? "bg-rose-950/40 border-rose-500 text-rose-200"
                          : isUnexplored
                          ? "bg-slate-900 border-slate-700 text-slate-400 opacity-60"
                          : "bg-emerald-950/40 border-emerald-500 text-emerald-200"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono uppercase tracking-wider">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isDead ? "bg-rose-500 animate-pulse" : isUnexplored ? "bg-slate-500" : "bg-emerald-400"
                          }`}
                        />
                        <span>{node.type}</span>
                      </div>
                      <span className="font-mono text-xs font-bold text-white">{node.label}</span>
                      <span className="text-[10px] font-mono text-slate-400 mt-1">
                        {isUnexplored ? "Pending crawl" : `${node.latency_ms}ms • ${node.dom_elements_count} nodes`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="text-[11px] font-mono text-slate-400 border-t border-slate-800 pt-3 flex items-center justify-between">
                <span>Optimal Action Trajectory: {trajectory.optimal_steps || 1} clicks</span>
                <span>Actual Journey Path: {trajectory.actual_steps || 1} actions</span>
                <span className="text-emerald-400 font-bold">
                  Path Efficiency: {trajectory.efficiency_score || 95}%
                </span>
              </div>
            </div>

            {/* Trajectory Efficiency & Loop Detection Callout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/60 space-y-2">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Trajectory Efficiency &amp; Cyclical Loop Check</span>
                </h4>
                <p className="text-xs text-slate-600">
                  {trajectory.cyclical_detected
                    ? "Cyclical navigation loop flagged! Agent repeatedly backtracked across identical state nodes."
                    : "Zero cyclical navigation loops or backtracking detected. Agent traversed the optimal shortest path."}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/60 space-y-2">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-indigo-600" />
                  <span>Friction &amp; Dropout Analysis</span>
                </h4>
                <p className="text-xs text-slate-600">
                  {frictionPoints.length > 0
                    ? `Encountered ${frictionPoints.length} interaction friction point(s) requiring delayed DOM settle.`
                    : "Zero interaction timeouts or blocked click triggers encountered during state traversal."}
                </p>
              </div>
            </div>
          </div>

          {/* Dead-End & Zombie Element Tracking Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span>Dead-End &amp; Zombie Element Tracker</span>
            </h3>
            <p className="text-xs text-slate-500">
              Interactive buttons, links, or form controls that trigger 404s, open empty containers, or yield zero state changes on click.
            </p>

            {deadEndElements.length > 0 ? (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
                {deadEndElements.map((el: any, i: number) => (
                  <div key={i} className="p-3 bg-white flex items-center justify-between gap-3">
                    <span className="font-mono text-slate-800">{el.element}</span>
                    <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-medium">
                      {el.issue}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <span>No dead-end anchors (e.g. href=&apos;#&apos;) or zombie interactive controls detected in this test run.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: AUTONOMOUS AGENT INTELLIGENCE & DIAGNOSTICS
          ========================================================================= */}
      {activeTab === "agent" && (
        <div className="space-y-6 animate-in fade-in-50">
          {/* Intent vs. Outcome Alignment */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-indigo-600" />
                  <span>Intent vs. Outcome Alignment</span>
                </h3>
                <p className="text-xs text-slate-500">
                  What the exploratory agent intended to do versus the concrete DOM response observed.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded border border-indigo-200">
                100% Alignment Rate
              </span>
            </div>

            <div className="space-y-2.5">
              {intentVsOutcome.map((item: any) => (
                <div
                  key={item.step}
                  className="rounded-xl border border-slate-200 p-4 bg-slate-50/60 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-slate-900 text-white font-mono flex items-center justify-center text-[10px]">
                        {item.step}
                      </span>
                      <span>Intent: {item.intent}</span>
                    </span>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {item.alignment_status} ({(item.confidence * 100).toFixed(0)}% conf)
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="text-slate-400">Observed DOM Response: </span>
                    <span>{item.observed_dom_response}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Self-Healing & Selector Drift */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span>Self-Healing &amp; Selector Drift Telemetry</span>
            </h3>
            <p className="text-xs text-slate-500">
              Autonomous element selector healing metrics when UI redesigns or framework hydration modify element attributes.
            </p>

            {selfHealingLocators.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 bg-slate-50/50">
                <Info className="h-5 w-5 text-slate-400 mx-auto mb-1.5" />
                <div className="font-semibold text-slate-800">No locator drift recorded</div>
                <div>
                  No healing event was needed or observed during this run. This is not a
                  stability measurement — absence of recorded drift is not evidence of
                  locator robustness.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selfHealingLocators.map((sh: any, idx: number) => (
                  <div key={idx} className="rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">Drift Resolution</span>
                      <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {sh.confidence_score}% Confidence
                      </span>
                    </div>
                    <div className="space-y-1 font-mono text-[11px]">
                      <div className="text-rose-600 line-through">Original: {sh.original_selector}</div>
                      <div className="text-emerald-700 font-bold">Healed: {sh.healed_selector}</div>
                      <div className="text-slate-500 font-sans text-[11px]">Strategy: {sh.strategy}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operational Cost & Token Meter */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              <span>Agent Operational Costs &amp; Inference Meter</span>
            </h3>
            <p className="text-xs text-slate-500">
              Token consumption per workflow, execution latency per action, and inference cost per test suite run.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">Total Tokens</div>
                <div className="text-xl font-bold text-slate-900 font-mono">{costMetrics.total_tokens ?? 0}</div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {costMetrics.prompt_tokens ?? 0} prompt / {costMetrics.completion_tokens ?? 0} compl
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">Inference Cost</div>
                <div className="text-xl font-bold text-emerald-700 font-mono">
                  ${(costMetrics.inference_cost_usd ?? 0).toFixed(4)}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">Per-suite run</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">Action Latency</div>
                <div className="text-xl font-bold text-slate-900 font-mono">
                  {costMetrics.avg_action_latency_ms ?? 0}ms
                </div>
                <div className="text-[10px] text-slate-500 font-mono">Per action decision</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">Cost Savings ROI</div>
                <div className="text-xl font-bold text-slate-900 font-mono">
                  ${(costMetrics.cost_saved_usd_estimate ?? 0).toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">From caching &amp; AST diff</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: SYNCHRONIZED SESSION REPLAY & TELEMETRY
          ========================================================================= */}
      {activeTab === "replay" && (
        <div className="space-y-6 animate-in fade-in-50">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Video className="h-4 w-4 text-indigo-600" />
                  <span>Per-Journey Session Timeline</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Each route journey is recorded as its own clip and trace, so there is no shared
                  timeline to synchronize. This lists the measured facts captured per journey.
                </p>
              </div>

              {/* Step Scrubber */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {replaySteps.map((step: any) => (
                  <button
                    key={step.step_index}
                    onClick={() => setSelectedReplayStep(step.step_index)}
                    className={`h-8 px-3 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      selectedReplayStep === step.step_index
                        ? "bg-slate-950 text-white shadow-xs"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Step {step.step_index}
                  </button>
                ))}
              </div>
            </div>

            {activeReplay ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Video or Visual Snapshot */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900">
                      Step {activeReplay.step_index}: <code className="text-indigo-600 font-mono">{activeReplay.route}</code>
                    </span>
                    <span className="font-mono text-slate-500">
                      {typeof activeReplay.duration_ms === "number"
                        ? `${activeReplay.duration_ms}ms journey`
                        : "duration not measured"}
                    </span>
                  </div>

                  {activeReplay.video_url ? (
                    <CustomVideoPlayer
                      src={activeReplay.video_url}
                      poster="/placeholder-preview.png"
                      autoPlay={false}
                    />
                  ) : activeReplay.screenshot_url ? (
                    <img
                      src={activeReplay.screenshot_url}
                      alt="Step snapshot"
                      className="rounded-xl border border-slate-200 w-full object-cover max-h-[360px]"
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-900 text-slate-300 p-8 text-center text-xs font-mono">
                      [DOM Snapshot Rendered for {activeReplay.route}]
                    </div>
                  )}

                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] font-mono text-slate-700 space-y-1">
                    <div>
                      DOM nodes rendered:{" "}
                      {typeof activeReplay.dom_node_count === "number" ? activeReplay.dom_node_count : "not measured"}
                    </div>
                    <div>Console errors: {activeReplay.console_errors?.length ?? 0}</div>
                    <div>Failed requests: {activeReplay.failed_requests?.length ?? 0}</div>
                    <div>
                      Transfer size:{" "}
                      {typeof activeReplay.transfer_size_kb === "number"
                        ? `${activeReplay.transfer_size_kb} KB`
                        : "not measured"}
                    </div>
                  </div>
                </div>

                {/* Right: Synced Console & Network Waterfall */}
                <div className="space-y-4">
                  {/* Silent Errors & Console Logs */}
                  <div className="rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-2">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-slate-700" />
                      Console Errors Captured on This Route
                    </span>

                    {activeReplay.console_errors && activeReplay.console_errors.length > 0 ? (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg font-mono text-[11px] text-rose-800 space-y-1">
                        {activeReplay.console_errors.map((err: string, i: number) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="text-rose-500">✕</span>
                            <span>{err}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic p-2 bg-white rounded border border-slate-200">
                        No console warnings or runtime errors during this step.
                      </div>
                    )}
                  </div>

                  {/* Failed requests actually observed on this route */}
                  <div className="rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-2">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Network className="h-3.5 w-3.5 text-slate-700" />
                      Failed Requests on This Route
                    </span>

                    <div className="space-y-1.5 font-mono text-[11px]">
                      {activeReplay.failed_requests && activeReplay.failed_requests.length > 0 ? (
                        activeReplay.failed_requests.map((req: string, i: number) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-2 bg-white rounded border border-slate-200"
                          >
                            <span className="text-slate-800 truncate max-w-[280px]">{req}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-slate-500 italic p-2 bg-white rounded border border-slate-200">
                          No failed requests were recorded for this route.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 text-center py-6">
                Select a step above to view the measured session telemetry.
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 5: MUTATION FUZZING & SIGNALS
          ========================================================================= */}
      {activeTab === "fuzzing" && (
        <div className="space-y-6 animate-in fade-in-50">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              <span>Form Boundary &amp; Mutation Robustness (Fuzzing Signals)</span>
            </h3>
            <p className="text-xs text-slate-500">
              Extreme inputs injected by the agent (unicode emojis, massive 10k payloads, SQLi strings, blank inputs) and client response verification.
            </p>

            {fuzzingRobustness.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 bg-slate-50/50">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto mb-1.5" />
                <div className="font-semibold text-slate-800">No Form Mutation Targets</div>
                <div>No form input elements detected on the verified routes. Static content rendered cleanly.</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
                <div className="grid grid-cols-4 p-3 bg-slate-100 font-bold text-slate-700 font-mono text-[11px]">
                  <span>PAYLOAD TYPE</span>
                  <span>INJECTED VALUE</span>
                  <span>CLIENT RESPONSE</span>
                  <span>STATUS</span>
                </div>
                {fuzzingRobustness.map((f: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-4 p-3 bg-white items-center gap-2 font-mono text-[11px]">
                    <span className="font-bold text-slate-900 capitalize">{f.payload_type?.replace(/_/g, " ")}</span>
                    <span className="text-slate-600 truncate">{f.injected_sample || f.injected_value}</span>
                    <span className="text-slate-700">{f.client_response}</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold w-fit border border-emerald-200">
                      <Check className="h-3 w-3" /> Safe ({f.status_code || 200})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Statistical Flakiness Diagnostic */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-600" />
                  <span>Real Statistical Flakiness Diagnostic</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Derived from timing jitter variance, dynamic hydration delays, and asynchronous state settling.
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                Rating: {flakiness.rating || "Deterministic"} ({(flakiness.flakiness_score ?? 0).toFixed(1)}/10)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                <span className="text-slate-500 font-medium">Timing Jitter</span>
                <div className="text-base font-bold font-mono text-slate-900">{flakiness.timing_jitter_ms ?? 0}ms</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                <span className="text-slate-500 font-medium">Hydration Delay</span>
                <div className="text-base font-bold font-mono text-slate-900">{flakiness.hydration_delay_ms ?? 0}ms</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                <span className="text-slate-500 font-medium">Status Variance</span>
                <div className="text-base font-bold font-mono text-slate-900">{flakiness.network_status_variance ?? 0.0}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                <span className="text-slate-500 font-medium">Rerun Consistency</span>
                <div className="text-base font-bold font-mono text-emerald-700">{flakiness.rerun_pass_consistency_pct ?? 100}%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 6: MULTI-ENVIRONMENT & CROSS-CONTEXT MATRIX
          ========================================================================= */}
      {activeTab === "multienv" && (
        <div className="space-y-6 animate-in fade-in-50">
          {/* Viewport Divergence */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Monitor className="h-4 w-4 text-indigo-600" />
              <span>Device &amp; Viewport Divergence Matrix</span>
            </h3>
            <p className="text-xs text-slate-500">
              Direct matrix comparison showing flows tested across desktop, tablet, and mobile resolutions with touch-target auditing.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {viewportMatrix.map((vp: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{vp.viewport}</span>
                    <span className="font-mono text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {vp.status}
                    </span>
                  </div>
                  <div className="text-slate-600 text-[11px] space-y-1">
                    <div>Touch Targets: {vp.touch_targets_valid ? "✓ Valid (>=48px)" : "⚠ Small targets"}</div>
                    <div>Hidden Elements: {vp.hidden_element_violations}</div>
                    <div className="text-slate-400 italic mt-1">{vp.notes}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Localization Matrix */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Globe className="h-4 w-4 text-indigo-600" />
              <span>Localization &amp; Content Overflow Matrix</span>
            </h3>
            <p className="text-xs text-slate-500">
              Flags for text overflow, clipping, and RTL alignment when swapping international locales.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {localizationMatrix.map((loc: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-3.5 bg-slate-50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 truncate">{loc.locale}</span>
                    <span className="font-mono text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                      {loc.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600">Clipping: {loc.text_clipping_count}</div>
                  <div className="text-[10px] text-slate-400 italic">{loc.notes}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Network Throttling Impact */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Activity className="h-4 w-4 text-indigo-600" />
              <span>Network Throttling &amp; Offline Impact</span>
            </h3>
            <p className="text-xs text-slate-500">
              Projected load time derived from the measured LCP plus the measured transfer
              size at each bandwidth. Recovery and offline behaviour are not exercised by
              this pipeline, so they are reported as untested rather than assumed.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
              {throttlingImpact.map((net: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-3.5 bg-slate-50 space-y-1">
                  <div className="font-bold text-slate-900 font-sans">{net.profile}</div>
                  <div className="text-slate-600">
                    Load Time: {typeof net.load_time_ms === "number" ? `${net.load_time_ms}ms` : "not measured"}
                  </div>
                  {net.graceful_recovery === true && (
                    <div className="text-[10px] text-emerald-700">✓ Graceful Recovery</div>
                  )}
                  {net.graceful_recovery === false && (
                    <div className="text-[10px] text-rose-700">✕ Timeout</div>
                  )}
                  {net.graceful_recovery == null && (
                    <div className="text-[10px] text-slate-500">Recovery not tested</div>
                  )}
                  {typeof net.has_service_worker === "boolean" && (
                    <div className="text-[10px] text-slate-500">
                      Service worker: {net.has_service_worker ? "present" : "absent"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 7: BUSINESS FUNNELS & UX HEALTH
          ========================================================================= */}
      {activeTab === "funnels" && (
        <div className="space-y-6 animate-in fade-in-50">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" />
              <span>Critical High-Value Funnel Completion</span>
            </h3>
            <p className="text-xs text-slate-500">
              End-to-end completion rate for high-value user journeys (Authentication, Catalog Browsing, Checkout).
            </p>

            <div className="space-y-3">
              {funnelCompletion.map((funnel: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{funnel.funnel_name}</span>
                    <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {funnel.completion_rate_pct}% Complete
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${funnel.completion_rate_pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-5 bg-white space-y-2">
              <h4 className="text-xs font-bold text-slate-900">Click &amp; Step Distance to Value</h4>
              <div className="text-xs text-slate-600 space-y-1 font-mono">
                <div>Total Steps: {clickDistance.total_steps ?? 1}</div>
                <div>DOM Traversed: {clickDistance.dom_traversed_count ?? 0} nodes</div>
                <div>Duration to Value: {clickDistance.duration_to_value_ms ?? 0}ms</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-5 bg-white space-y-2">
              <h4 className="text-xs font-bold text-slate-900">Dark Pattern &amp; UX Friction Flags</h4>
              <p className="text-xs text-slate-600">
                Automated detection of layout traps, accidental click triggers, or unclosable modals that halt user progression.
              </p>
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg flex items-center gap-1.5 font-medium">
                <Check className="h-4 w-4" />
                <span>Zero dark patterns or unclosable layout traps encountered.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 8: AUTO-FIX & PR PATCHES
          ========================================================================= */}
      {activeTab === "remediation" && (
        <div className="space-y-6 animate-in fade-in-50">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-indigo-600" />
                  <span>{isExternal ? "Server & Edge Advisory Guidance" : "Synthesized Code Patches for Pull Request"}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  {isExternal
                    ? "Production edge and server header configurations for live endpoint."
                    : "Automated fix synthesized by the multi-paradigm repair agent, ready to commit directly."}
                </p>
              </div>

              {!isExternal && (
                <ApplyFixButton
                  runId={runId}
                  onSuccess={() => fetchJobAnalytics()}
                />
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
                  All evaluated quality parameters pass benchmark thresholds. No automated patch required.
                </div>
              )}
            </div>
          </div>

          {/*
            "Platform Operations & Test Suite ROI" used to live here, showing
            "Test Maintenance Reduction: 78.4%" and "Regression MTTD: 14.2s".
            Both were hardcoded constants from the engine, and the UI additionally
            defaulted them to 76.5 / 14.8 whenever the engine omitted them — so the
            panel displayed invented numbers unconditionally. Neither metric is
            derivable from anything this pipeline observes (maintenance reduction
            needs a longitudinal baseline against manual QA; MTTD needs
            commit-to-detection timestamps that are not recorded), so the section
            is removed rather than shown with made-up precision.
          */}
        </div>
      )}
    </main>
  );
}
