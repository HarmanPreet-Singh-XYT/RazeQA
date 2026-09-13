"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ExternalLink,
  ChevronDown,
  Calendar,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Activity,
  Globe,
  MoreHorizontal,
  X,
  RefreshCw,
  Search,
  ArrowUpRight,
  Brain,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Compass,
  Layers,
  GitBranch,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";

export default function AnalyticsClient({ userEmail }: { userEmail: string }) {
  const { activeRepo, projects } = useDashboard();
  const searchParams = useSearchParams();
  const urlRepo = searchParams?.get("repo");
  const isOverviewMode = !urlRepo;

  const [projectFilter, setProjectFilter] = useState<string>(urlRepo || "all");
  const projectName = activeRepo
    ? activeRepo.split("/")[1] || activeRepo
    : projects[0]?.name || projects[0]?.repo_full_name?.split("/")[1] || "All Projects";

  const displayProjectName =
    projectFilter !== "all"
      ? projectFilter.split("/")[1] || projectFilter
      : urlRepo
      ? urlRepo.split("/")[1] || urlRepo
      : activeRepo?.split("/")[1] || activeRepo;

  const [timeRange, setTimeRange] = useState("Last 7 Days");
  const [suiteScope, setSuiteScope] = useState("All Suites");

  // Live analytics state
  const [metricsData, setMetricsData] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // AI QA Insights Assistant
  const [aiQuery, setAiQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);

  useEffect(() => {
    async function loadAnalytics() {
      setIsLoading(true);
      try {
        const targetRepo = urlRepo || (projectFilter !== "all" ? projectFilter : null);
        const repoParam = targetRepo ? `?repo=${encodeURIComponent(targetRepo)}` : "";
        const [analyticsRes, runsRes] = await Promise.all([
          fetch("/api/analytics").catch(() => null),
          fetch(`/api/runs${repoParam}`).catch(() => null),
        ]);

        if (analyticsRes && analyticsRes.ok) {
          const aData = await analyticsRes.json();
          setMetricsData(aData);
        }

        if (runsRes && runsRes.ok) {
          const rData = await runsRes.json();
          setRuns(Array.isArray(rData) ? rData : rData.runs || []);
        }
      } catch (err) {
        console.error("Failed to load analytics", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadAnalytics();
  }, [urlRepo, projectFilter, activeRepo]);

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    setIsQuerying(true);
    setAiResponse(null);

    try {
      const res = await fetch("/api/analytics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.response || data.answer || data.insight || JSON.stringify(data, null, 2);
        setAiResponse(text);
      } else {
        const err = await res.json().catch(() => ({}));
        setAiResponse(err.error || `AI analyst unavailable (HTTP ${res.status}). Ensure backend is active.`);
      }
    } catch (err: any) {
      setAiResponse(err?.message || "Could not reach AI analytics engine.");
    } finally {
      setIsQuerying(false);
    }
  };

  // Compute live metrics from runs
  const totalRuns = runs.length;
  const passedRuns = runs.filter((r) => r.status === "passed" || r.result?.status === "success").length;
  const failedRuns = runs.filter((r) => r.status === "failed" || r.result?.status === "failure").length;
  const passRate = totalRuns > 0 ? ((passedRuns / totalRuns) * 100).toFixed(1) : "--";

  // Calculate average duration
  const durations = runs
    .map((r) => Number(r.result?.duration_s || parseFloat(r.duration) || 0))
    .filter((d) => d > 0);
  const avgDuration = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) + "s" : "--";

  // Extract journey velocity from actual runs if available
  const journeyMap = new Map<string, { durations: number[]; passed: number; failed: number }>();
  runs.forEach((r) => {
    const journeys = r.result?.journey_artifacts || r.result?.passed_journeys || [];
    journeys.forEach((j: any) => {
      const name = typeof j === "string" ? j : j.name || j.journey_name || "User Flow";
      const existing = journeyMap.get(name) || { durations: [], passed: 0, failed: 0 };
      if (j.duration_ms) existing.durations.push(j.duration_ms / 1000);
      if (j.status === "failed") existing.failed++;
      else existing.passed++;
      journeyMap.set(name, existing);
    });
  });

  const liveJourneys = Array.from(journeyMap.entries()).map(([name, stats]) => {
    const avg = stats.durations.length > 0 ? (stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length).toFixed(1) + "s" : "< 1s";
    const total = stats.passed + stats.failed;
    const flakinessPct = total > 0 && stats.failed > 0 ? ((stats.failed / total) * 100).toFixed(0) + "%" : "0%";
    return {
      name,
      avgDuration: avg,
      flakiness: flakinessPct,
      status: stats.failed === 0 ? "Stable" : "Regression",
    };
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full text-slate-900 animate-in fade-in-50 duration-200">
      {/* Header & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950 flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600" />
            <span>
              {isOverviewMode && projectFilter === "all"
                ? "Fleet Quality & Reliability Analytics"
                : `Quality Analytics · ${displayProjectName}`}
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isOverviewMode && projectFilter === "all"
              ? "Fleet-wide test suite metrics, flakiness detection, and failure categorization across all workspace projects."
              : `Real-time test suite metrics, flakiness detection, and failure categorization for ${displayProjectName}.`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-semibold text-slate-700 px-3 py-1.5 rounded-md focus:outline-hidden focus:border-slate-400 cursor-pointer shadow-2xs"
          >
            <option value="all">All Projects ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.repo_full_name} value={p.repo_full_name}>
                {p.name || p.repo_full_name.split("/")[1] || p.repo_full_name}
              </option>
            ))}
          </select>

          <select
            value={suiteScope}
            onChange={(e) => setSuiteScope(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-semibold text-slate-700 px-3 py-1.5 rounded-md focus:outline-hidden focus:border-slate-400 cursor-pointer shadow-2xs"
          >
            <option value="All Suites">All Test Suites</option>
            <option value="Functional">Functional Only</option>
            <option value="Visual">Visual Regression</option>
          </select>

          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-semibold text-slate-700 px-3 py-1.5 rounded-md focus:outline-hidden focus:border-slate-400 cursor-pointer shadow-2xs"
          >
            <option value="Last 24 Hours">Last 24 Hours</option>
            <option value="Last 7 Days">Last 7 Days</option>
            <option value="Last 30 Days">Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* 3 Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Pass Rate Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Test Suite Pass Rate
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-950 font-mono">
              {totalRuns > 0 ? `${passRate}%` : "Awaiting runs"}
            </span>
            {totalRuns > 0 && (
              <span className="text-xs font-mono text-emerald-600 font-semibold">
                ({passedRuns}/{totalRuns} passed)
              </span>
            )}
          </div>
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: totalRuns > 0 ? `${passRate}%` : "0%" }}
            />
          </div>
        </div>

        {/* Flakiness Index */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Flakiness Index
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-950 font-mono">
              {failedRuns > 0 ? `${((failedRuns / (totalRuns || 1)) * 100).toFixed(1)}%` : "0.0%"}
            </span>
            <span className="text-xs font-mono text-emerald-600 font-semibold">
              {failedRuns === 0 ? "Ultra-low" : "Active regressions"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            {totalRuns > 0 ? `${totalRuns} verified commit runs analyzed` : "No flaky journeys detected"}
          </p>
        </div>

        {/* Avg Test Run Time */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Avg Verification Duration
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-950 font-mono">{avgDuration}</span>
            <span className="text-xs font-mono text-indigo-600 font-semibold">Headless sandbox</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Deterministic SHA caching skips redundant browser execution
          </p>
        </div>
      </div>

      {/* Quality Analytics Query Assistant */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 text-xs font-bold uppercase tracking-wider">
          <Brain className="h-4 w-4 text-slate-700" />
          <span>Quality Analytics Intelligence</span>
        </div>

        <form onSubmit={handleAskAI} className="flex gap-2">
          <input
            type="text"
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder="Ask test analytics: 'Why did tests fail on the latest branch?' or 'Summarize test quality regressions'..."
            className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition-all shadow-xs"
          />
          <Button
            type="submit"
            disabled={isQuerying || !aiQuery.trim()}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-4 cursor-pointer font-semibold shadow-xs disabled:opacity-50"
          >
            {isQuerying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </form>

        {aiResponse && (
          <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed animate-in fade-in-50 shadow-xs whitespace-pre-wrap">
            {aiResponse}
          </div>
        )}
      </div>

      {/* Two-column layout: Journey Velocity & Failure Taxonomy */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: User Journey Velocity & Reliability Table */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Compass className="h-3.5 w-3.5 text-slate-900" />
              User Journey Performance &amp; Flakiness
            </span>
            <Link
              href="/dashboard/tools"
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              View Journeys →
            </Link>
          </div>

          {liveJourneys.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg bg-slate-50">
              No individual user journeys captured yet. Trigger a verification run to populate journey velocity metrics.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {liveJourneys.map((j, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900 block truncate">{j.name}</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Avg Duration: {j.avgDuration}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        j.status === "Stable"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {j.status} ({j.flakiness} flaky)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Failure Breakdown Taxonomy */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Test Failure Taxonomy (Root Causes)
          </span>

          {failedRuns === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg bg-slate-50 space-y-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
              <p className="font-semibold text-slate-800">Zero Active Regressions</p>
              <p className="text-[11px] text-slate-500">All recent test runs verified clean without failure regressions.</p>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Assertion Failures</span>
                  <span className="font-mono text-slate-900 font-bold">{failedRuns} runs</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: "100%" }} />
                </div>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
            AutoQA automatically flags selector regressions and synthesizes automated code patches.
          </p>
        </div>
      </div>
    </div>
  );
}
