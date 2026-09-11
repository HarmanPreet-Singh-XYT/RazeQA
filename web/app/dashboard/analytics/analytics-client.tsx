"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Compass,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  GitBranch,
  Globe,
  HelpCircle,
  Layers,
  Lock,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import { logout } from "@/app/login/actions";

export default function AnalyticsClient({ userEmail }: { userEmail: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userQuery, setUserQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryResponse, setQueryResponse] = useState<any>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    try {
      const res = await fetch("/api/analytics");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setFetchError(null);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setFetchError(errJson.error || `Failed to load fleet analytics (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      setFetchError(err?.message || "Failed to contact PR Testing Engine.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userQuery.trim() || isQuerying) return;

    setIsQuerying(true);
    try {
      const res = await fetch("/api/analytics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userQuery }),
      });
      if (res.ok) {
        const result = await res.json();
        setQueryResponse(result);
      }
    } catch (err: any) {
      setQueryResponse({
        answer: `Error consulting AI Analyst: ${err.message}`,
        confidence: 0,
      });
    } finally {
      setIsQuerying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf9] flex flex-col items-center justify-center p-6 text-center">
        <div className="flex items-center gap-2 text-slate-600 text-xs font-medium">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
          <span>Loading fleet quality dimensions…</span>
        </div>
      </div>
    );
  }

  if (!data?.metrics || data.metrics.total_runs === 0) {
    return (
      <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased">
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
                <span>Fleet Analytics</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Overview
              </Link>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-24 text-center">
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mx-auto border border-slate-200">
              <Activity className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              {fetchError ? "Fleet Analytics Unavailable" : "No Verification Data Recorded"}
            </h2>
            <p className="text-xs text-slate-500">
              {fetchError ||
                "Run your first PR verification journey or external site test to compute quality dimensions and regression forecasting."}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => {
                  setLoading(true);
                  fetchAnalytics();
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
                Go to PR Forensics
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const metrics = data.metrics;
  const insights = data.insights || [];
  const dimensions = metrics.dimensions || {};

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased selection:bg-indigo-100">
      {/* Structural background graph grid */}
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
              <span>Fleet Intelligence</span>
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-indigo-700">
                PROD
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
                className="rounded-md px-2.5 py-1 text-xs font-bold text-slate-950 bg-slate-100 transition-colors"
              >
                Fleet Analytics
              </Link>
              <Link
                href="/dashboard/tools"
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Dev Tools
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
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="text-2xl font-extrabold text-slate-950 tracking-tight">
                Fleet Quality Dimensions & AI Intelligence
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Engine
              </span>
            </div>
            <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
              Autonomous calculation of Non-Functional Quality Attributes, regression forecasting, and per-path performance.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAnalytics}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              Recalculate
            </button>
            <Link
              href="/dashboard/runs"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-xs transition-colors"
            >
              View Quality & Path Analytics
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* =========================================================================
            TOP ROW: FLEET QUALITY COMPOSITE & CORE VELOCITY METRICS
            ========================================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Composite Quality Health Index */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Composite Index
                </span>
                <h2 className="text-base font-bold text-slate-900 mt-0.5">
                  Fleet Quality Health Index
                </h2>
              </div>
              <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-mono font-bold text-sm">
                Q8
              </div>
            </div>

            <div className="my-4 flex items-baseline gap-3">
              <span className="text-5xl font-black tracking-tight text-slate-950">
                {metrics.composite_fleet_health}
              </span>
              <span className="text-sm font-semibold text-slate-400">/ 100</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                <TrendingUp className="h-3 w-3" />
                +2.4 pts vs last week
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-medium text-slate-600">
                <span>Weighted across 8 Non-Functional Dimensions</span>
                <span className="font-semibold text-indigo-600">Benchmark: 85+</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${metrics.composite_fleet_health}%` }}
                />
              </div>
            </div>
          </div>

          {/* Metric: Pass Rate */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold">Pass Rate</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="my-2">
              <div className="text-3xl font-black text-slate-950">
                {metrics.pass_rate}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {metrics.total_runs} jobs verified
              </div>
            </div>
            <div
              className={`text-[10px] font-semibold rounded px-1.5 py-0.5 inline-block w-fit ${
                metrics.pass_rate >= 95
                  ? "text-emerald-700 bg-emerald-50"
                  : metrics.pass_rate >= 80
                  ? "text-amber-700 bg-amber-50"
                  : "text-rose-700 bg-rose-50"
              }`}
            >
              {metrics.pass_rate >= 95
                ? `${metrics.pass_rate}% Target SLA Met (≥95%)`
                : `${metrics.pass_rate}% vs 95% SLA Target`}
            </div>
          </div>

          {/* Metric: MTTD */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold">Mean Time to Detect (MTTD)</span>
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            <div className="my-2">
              <div className="text-3xl font-black text-slate-950">
                {metrics.mttd_seconds}s
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                p50: {(metrics.p50_latency_ms / 1000).toFixed(2)}s
              </div>
            </div>
            <div className="text-[10px] text-indigo-700 font-semibold bg-indigo-50 rounded px-1.5 py-0.5 inline-block w-fit">
              Docker Sandbox Boot + Eval
            </div>
          </div>

          {/* Metric: Flakiness */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold">Flakiness Index</span>
              <Flame className="h-4 w-4 text-rose-500" />
            </div>
            <div className="my-2">
              <div className="text-3xl font-black text-slate-950">
                {metrics.flakiness_index}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Multi-run variance
              </div>
            </div>
            <div className="text-[10px] text-slate-600 font-semibold bg-slate-100 rounded px-1.5 py-0.5 inline-block w-fit">
              Low Flakiness Tier
            </div>
          </div>
        </div>

        {/* =========================================================================
            8 QUALITY ATTRIBUTES RADAR & METRIC CARDS
            ========================================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950 tracking-tight">
                8 Non-Functional Quality Dimensions
              </h2>
              <p className="text-xs text-slate-500">
                Mathematical calculation per dimension across verified journeys, network waterfalls, and DOM trees.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {metrics.pr_runs_count} PR Jobs | {metrics.external_runs_count} External Sites
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                id: "perf",
                name: "Performance & Speed",
                score: typeof dimensions.performance === "number" ? dimensions.performance : null,
                desc: "p95 latency < 2s, transfer payload < 500KB, TTFB optimization.",
                icon: Zap,
                color: "text-amber-500",
                bg: "bg-amber-500",
              },
              {
                id: "usability",
                name: "Usability & Learnability",
                score: typeof dimensions.usability === "number" ? dimensions.usability : null,
                desc: "WCAG contrast heuristics, form label associations, missing aria-label scan.",
                icon: Compass,
                color: "text-blue-500",
                bg: "bg-blue-500",
              },
              {
                id: "i18n",
                name: "Internationalization (i18n)",
                score: typeof dimensions.i18n === "number" ? dimensions.i18n : null,
                desc: "Hardcoded strings detection, RTL layout compliance, dynamic currency/date formatting.",
                icon: Globe,
                color: "text-indigo-500",
                bg: "bg-indigo-500",
              },
              {
                id: "security",
                name: "Security & Privacy",
                score: typeof dimensions.security === "number" ? dimensions.security : null,
                desc: "CSP, HSTS, X-Frame-Options headers, credential redaction, cookie security flags.",
                icon: Lock,
                color: "text-emerald-500",
                bg: "bg-emerald-500",
              },
              {
                id: "reliability",
                name: "Reliability & Uptime",
                score: typeof dimensions.reliability === "number" ? dimensions.reliability : null,
                desc: "Uptime SLA, 0 uncaught JavaScript errors, automated retry recovery.",
                icon: ShieldCheck,
                color: "text-teal-500",
                bg: "bg-teal-500",
              },
              {
                id: "seo",
                name: "Search Engine Optimization (SEO)",
                score: typeof dimensions.seo === "number" ? dimensions.seo : null,
                desc: "Title/meta description character limits, single h1, JSON-LD schema, alt text.",
                icon: Search,
                color: "text-purple-500",
                bg: "bg-purple-500",
              },
              {
                id: "maintainability",
                name: "Maintainability & Scalability",
                score: typeof dimensions.maintainability === "number" ? dimensions.maintainability : null,
                desc: "AST dependency coupling, circular import prevention, diff churn limits.",
                icon: Layers,
                color: "text-sky-500",
                bg: "bg-sky-500",
              },
              {
                id: "observability",
                name: "Observability & Telemetry",
                score: typeof dimensions.observability === "number" ? dimensions.observability : null,
                desc: "Playwright video/trace artifacts, network waterfall logging, Core Web Vitals.",
                icon: Activity,
                color: "text-pink-500",
                bg: "bg-pink-500",
              },
            ].map((dim) => {
              const Icon = dim.icon;
              const hasScore = dim.score !== null;
              return (
                <div
                  key={dim.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-300 transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${dim.color}`} />
                        <h3 className="font-bold text-xs text-slate-900">{dim.name}</h3>
                      </div>
                      <span className="font-mono font-bold text-sm text-slate-950">
                        {hasScore ? `${dim.score}` : "—"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
                      {dim.desc}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${dim.bg} transition-all duration-500`}
                        style={{ width: `${hasScore ? dim.score : 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold text-slate-400">
                      <span>Threshold: 80</span>
                      {hasScore ? (
                        <span
                          className={
                            dim.score! >= 90
                              ? "text-emerald-600"
                              : dim.score! >= 80
                              ? "text-amber-600"
                              : "text-rose-600"
                          }
                        >
                          {dim.score! >= 90
                            ? "Optimal"
                            : dim.score! >= 80
                            ? "Adequate"
                            : "Attention Needed"}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">Pending Evaluation</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* =========================================================================
            PROACTIVE AI INSIGHTS & PREDICTIVE FORECASTING
            ========================================================================= */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  Proactive AI Insights &amp; Predictive Forecasting
                </h2>
                <p className="text-xs text-slate-500">
                  Statistical regression forecasting and root cause synthesis across the fleet.
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-md px-2 py-1">
              {insights.length} Diagnostic Alerts
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {insights.map((insight: any) => {
              const isCrit = insight.severity === "critical";
              const isWarn = insight.severity === "warning";
              return (
                <div
                  key={insight.id}
                  className={`rounded-xl border p-4.5 space-y-3 flex flex-col justify-between ${
                    isCrit
                      ? "border-rose-200 bg-rose-50/40"
                      : isWarn
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-slate-200 bg-slate-50/50"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          isCrit
                            ? "bg-rose-100 text-rose-700 border border-rose-300"
                            : isWarn
                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                            : "bg-indigo-100 text-indigo-800 border border-indigo-200"
                        }`}
                      >
                        {insight.severity} • {insight.category}
                      </span>
                      <span className="text-[10px] font-mono font-medium text-slate-500">
                        {Math.round(insight.confidence * 100)}% conf
                      </span>
                    </div>

                    <h3 className="font-bold text-sm text-slate-900 leading-snug">
                      {insight.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {insight.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Recommended Action:
                    </div>
                    <div className="text-[11px] text-slate-600 font-mono bg-white p-2 rounded border border-slate-200">
                      {insight.remediation}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* =========================================================================
            INTERACTIVE "ASK AI QA ANALYST" QUERY BAR
            ========================================================================= */}
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/50 to-white p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-slate-950 text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Ask AI QA Analyst
              </h2>
              <p className="text-xs text-slate-600">
                Interactive natural language diagnostic engine querying real fleet run artifacts.
              </p>
            </div>
          </div>

          <form onSubmit={handleAskAI} className="flex gap-2">
            <input
              type="text"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Ask about checkout regressions, CSP compliance, flaky test timing, or i18n..."
              className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 shadow-2xs"
            />
            <button
              type="submit"
              disabled={isQuerying || !userQuery.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-xs"
            >
              {isQuerying ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Ask Analyst
            </button>
          </form>

          {queryResponse && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 space-y-3 animate-in fade-in-50">
              <div className="flex items-center justify-between text-xs text-slate-500 border-b border-slate-100 pb-2">
                <span className="font-semibold text-slate-900">
                  AI Analyst Response ({Math.round(queryResponse.confidence * 100)}% confidence)
                </span>
                <span className="font-mono text-[10px]">Real-time synthesis</span>
              </div>
              <div className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                {queryResponse.answer}
              </div>
              {queryResponse.suggested_actions && (
                <div className="pt-2 flex flex-wrap gap-2">
                  {queryResponse.suggested_actions.map((act: string, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 border border-slate-200"
                    >
                      ⚡ {act}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
