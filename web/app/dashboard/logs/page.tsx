"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  RefreshCw,
  Terminal,
  Clock,
  Filter,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  GitBranch,
  Play,
  Layers,
  Sparkles,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";

interface LogEntry {
  id: string;
  time: string;
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR";
  runner: string;
  journey: string;
  message: string;
  project?: string;
}

export default function LogsPage() {
  const { activeRepo, projects } = useDashboard();
  const searchParams = useSearchParams();
  const urlRepo = searchParams?.get("repo");
  const isOverviewMode = !urlRepo;

  const [projectFilter, setProjectFilter] = useState<string>(urlRepo || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLive, setIsLive] = useState(true);
  const [timelineRange, setTimelineRange] = useState("Last 24 hours");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter checkboxes
  const [warningChecked, setWarningChecked] = useState(true);
  const [errorChecked, setErrorChecked] = useState(true);
  const [infoChecked, setInfoChecked] = useState(true);

  const fetchLiveLogs = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const targetRepo = urlRepo || (projectFilter !== "all" ? projectFilter : null);
      const repoParam = targetRepo ? `&repo=${encodeURIComponent(targetRepo)}` : "";
      const [runsRes, intentsRes] = await Promise.all([
        fetch(`/api/runs?limit=50${repoParam}`).catch(() => null),
        fetch("/api/intents?limit=50").catch(() => null),
      ]);

      const entries: LogEntry[] = [];

      // Extract logs from live runs
      if (runsRes && runsRes.ok) {
        const runsData = await runsRes.json();
        const runsList = Array.isArray(runsData) ? runsData : runsData.runs || [];

        for (const [runIdx, run] of runsList.entries()) {
          const runId = run.id || run.run_id || `run-${runIdx}-${run.created_at || Date.now()}`;
          const runTime = new Date(run.created_at || Date.now());
          const timeStr = runTime.toLocaleTimeString("en-US", { hour12: false });
          const runRepo =
            run.repo ||
            run.repo_full_name ||
            (run.target_url ? new URL(run.target_url).hostname : targetRepo || activeRepo || projects[0]?.repo_full_name || "Workspace");

          // Run dispatch event
          entries.push({
            id: `run-start-${runId}`,
            time: timeStr,
            timestamp: runTime.getTime(),
            level: "INFO",
            runner: "Orchestrator",
            journey: run.branch || "main",
            message: `Execution initiated for commit ${run.commit_sha?.slice(0, 7) || "HEAD"} [Scope: ${run.scope || "changed"}]`,
            project: runRepo,
          });

          // Run status
          if (run.status === "completed" || run.status === "passed") {
            entries.push({
              id: `run-end-${runId}`,
              time: timeStr,
              timestamp: runTime.getTime() + 500,
              level: "INFO",
              runner: "Playwright Worker",
              journey: run.branch || "main",
              message: `✓ All user journey assertions verified green (${run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "completed"})`,
              project: runRepo,
            });
          } else if (run.status === "failed") {
            entries.push({
              id: `run-fail-${runId}`,
              time: timeStr,
              timestamp: runTime.getTime() + 500,
              level: "ERROR",
              runner: "Playwright Worker",
              journey: run.branch || "main",
              message: `Assertion failure in test suite: ${run.summary || "Expected DOM elements did not match snapshot"}`,
              project: runRepo,
            });
          }

          // Individual journey results if stored in test_results
          if (Array.isArray(run.test_results)) {
            for (const [stepIdx, step] of run.test_results.entries()) {
              entries.push({
                id: `step-${runId}-${stepIdx}-${step.id || "step"}`,
                time: timeStr,
                timestamp: runTime.getTime() + 200,
                level: step.status === "failed" ? "ERROR" : "INFO",
                runner: "Chromium Worker",
                journey: step.journey_name || step.name || "Test Flow",
                message: step.message || `${step.action || "Step"}: ${step.selector || step.url || "verified"}`,
                project: runRepo,
              });
            }
          }
        }
      }

      // Extract logs from intent events
      if (intentsRes && intentsRes.ok) {
        const intentsData = await intentsRes.json();
        const intentList = Array.isArray(intentsData) ? intentsData : intentsData.intents || [];

        for (const [itIdx, it] of intentList.entries()) {
          const itId = it.id || `intent-${itIdx}-${it.created_at || Date.now()}`;
          const itTime = new Date(it.created_at || Date.now());
          const timeStr = itTime.toLocaleTimeString("en-US", { hour12: false });
          entries.push({
            id: `intent-${itId}`,
            time: timeStr,
            timestamp: itTime.getTime(),
            level: it.status === "error" ? "ERROR" : it.status === "warning" ? "WARN" : "INFO",
            runner: "Autonomous Agent",
            journey: it.journey_id || "Intent Discovery",
            message: `${it.action || it.event_type || "Intent"} on ${it.url || "/"}: ${it.description || JSON.stringify(it.payload || {})}`,
            project: activeRepo || "Workspace",
          });
        }
      }

      // Sort newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(entries);
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [urlRepo, projectFilter, activeRepo]);

  // Initial load
  useEffect(() => {
    fetchLiveLogs();
  }, [fetchLiveLogs]);

  // Polling if isLive is enabled
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => {
      fetchLiveLogs();
    }, 15000);
    return () => clearInterval(timer);
  }, [isLive, fetchLiveLogs]);

  const filteredLogs = logs.filter((log) => {
    if (projectFilter !== "all" && log.project) {
      const cleanFilter = projectFilter.toLowerCase();
      const cleanProject = log.project.toLowerCase();
      if (!cleanProject.includes(cleanFilter) && !cleanFilter.includes(cleanProject)) {
        return false;
      }
    }

    const matchesSearch =
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.journey.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.runner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.project && log.project.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (log.level === "ERROR" && !errorChecked) return false;
    if (log.level === "WARN" && !warningChecked) return false;
    if (log.level === "INFO" && !infoChecked) return false;
    return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full animate-in fade-in-50 text-slate-900">
      {/* Top Header & Search Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-xl w-full">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Playwright steps, assertions, console logs..."
            className="w-full bg-slate-50 border border-slate-200 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition-colors"
          />
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-2">
          {/* Live stream toggle */}
          <button
            onClick={() => setIsLive(!isLive)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border font-medium transition-colors cursor-pointer ${
              isLive
                ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isLive ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
              }`}
            />
            <span className="font-mono text-[11px]">{isLive ? "Live Stream" : "Paused"}</span>
          </button>

          {/* Refresh button */}
          <button
            onClick={() => fetchLiveLogs()}
            disabled={isRefreshing}
            className="p-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Filter Facets Sidebar */}
        <div className="lg:col-span-3 space-y-4 text-xs">
          {/* Project Scope Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Project Scope
            </span>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900"
            >
              <option value="all">All Projects ({projects.length})</option>
              {projects.map((p) => (
                <option key={p.repo_full_name} value={p.repo_full_name}>
                  {p.name || p.repo_full_name.split("/")[1] || p.repo_full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Timeline & Date Range Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Timeline Range
            </span>
            <select
              value={timelineRange}
              onChange={(e) => setTimelineRange(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900"
            >
              <option>Last 15 minutes</option>
              <option>Last 30 minutes</option>
              <option>Last 1 hour</option>
              <option>Last 24 hours</option>
            </select>
          </div>

          {/* Severity Checkboxes */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Filter By Severity
            </span>
            <label className="flex items-center gap-2 text-slate-700 hover:text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={infoChecked}
                onChange={(e) => setInfoChecked(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Info (Steps &amp; Actions)</span>
            </label>
            <label className="flex items-center gap-2 text-slate-700 hover:text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={warningChecked}
                onChange={(e) => setWarningChecked(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Warnings (Timeouts &amp; Retries)</span>
            </label>
            <label className="flex items-center gap-2 text-slate-700 hover:text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={errorChecked}
                onChange={(e) => setErrorChecked(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Errors (Failed Assertions)</span>
            </label>
          </div>

          {/* Target Info Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Execution Context
            </span>
            <div className="space-y-1.5 text-[11px] text-slate-600 font-mono">
              <div className="flex items-center justify-between py-0.5">
                <span className="text-slate-400">Target</span>
                <span className="truncate max-w-[150px] font-medium text-slate-800">
                  {projectFilter !== "all" ? projectFilter.split("/")[1] || projectFilter : "All Projects"}
                </span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-slate-400">Stream</span>
                <span className="text-emerald-600 font-semibold">{isLive ? "Live" : "Paused"}</span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-slate-400">Total Events</span>
                <span className="text-slate-800 font-semibold">{logs.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Logs Feed */}
        <div className="lg:col-span-9 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden flex flex-col">
          {/* Feed Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 text-xs">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-slate-600" />
              <span className="font-semibold text-slate-900">Execution Stream</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              {projectFilter !== "all" ? projectFilter : "All Projects (Fleet)"}
            </span>
          </div>

          {/* Log Lines Container */}
          <div className="bg-slate-950 text-slate-200 divide-y divide-slate-800/80 font-mono text-xs overflow-x-auto min-h-[440px] max-h-[640px] overflow-y-auto">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
                <span>Loading execution logs...</span>
              </div>
            ) : filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="px-4 py-2 hover:bg-slate-900/90 transition-colors flex items-start gap-3 text-[11px]"
                >
                  <span className="text-slate-500 shrink-0 select-none">{log.time}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded shrink-0 font-bold text-[10px] ${
                      log.level === "INFO"
                        ? "bg-sky-950/60 text-sky-400 border border-sky-800/40"
                        : log.level === "WARN"
                        ? "bg-amber-950/60 text-amber-400 border border-amber-800/40"
                        : "bg-red-950/60 text-red-400 border border-red-800/40"
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-slate-400 shrink-0 font-medium">[{log.runner}]</span>
                  {log.project && (
                    <span className="text-indigo-400/90 shrink-0 hidden md:inline">
                      [{log.project.split("/")[1] || log.project}]
                    </span>
                  )}
                  <span className="text-slate-400 shrink-0 hidden sm:inline">
                    [{log.journey}]
                  </span>
                  <span className="text-slate-100 min-w-0 break-words flex-1">
                    {log.message}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                <Terminal className="h-8 w-8 text-slate-600" />
                <div className="space-y-1">
                  <p className="font-semibold text-slate-300">No execution logs recorded</p>
                  <p className="text-[11px] text-slate-500 max-w-sm">
                    {searchQuery
                      ? "No events match your search query or severity filters."
                      : "Trigger a test run from the dashboard or push a commit to stream live Playwright logs."}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Feed Footer */}
          <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
            <span>Real-time autonomous test runner events</span>
            <span className="font-mono font-medium text-slate-700">
              {filteredLogs.length} events displayed
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
