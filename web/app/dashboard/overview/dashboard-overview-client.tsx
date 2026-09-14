"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GitCommit,
  Star,
  Globe,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  Cpu,
  Terminal,
  Clock,
  ArrowUpRight,
  Filter,
  LayoutGrid,
  List,
  SlidersHorizontal,
  RefreshCw,
  FolderGit2,
  Radio,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard, ProjectInfo } from "@/components/dashboard-context";
import { ExternalTestModal } from "@/components/external-test-modal";

function GithubOctocatIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function SparklineWave({ className = "w-6 h-6", active = true }: { className?: string; active?: boolean }) {
  return (
    <div
      className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
        active
          ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
          : "bg-slate-100/60 text-slate-400"
      } ${className}`}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l3-8 4 16 3-8h4" />
      </svg>
    </div>
  );
}

export function DashboardOverviewClient({ userEmail }: { userEmail?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projects, setActiveRepo, refreshProjects, isLoadingProjects, engineConnected } = useDashboard();

  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterType, setFilterType] = useState<"all" | "git" | "external" | "starred">("all");
  const [isAddNewOpen, setIsAddNewOpen] = useState(false);
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false);
  const [starredMap, setStarredMap] = useState<Record<string, boolean>>({});

  // A project deleted from Project Settings redirects here, where the remaining
  // projects (or the empty state) live. The confirmation travels in the query
  // string so the message survives the navigation instead of being lost with
  // the settings screen's component state.
  const deletedRepo = searchParams ? searchParams.get("deleted") : null;
  const deletedRuns = searchParams ? Number(searchParams.get("deleted_runs") || 0) : 0;
  const [showDeletedBanner, setShowDeletedBanner] = useState(Boolean(deletedRepo));

  useEffect(() => {
    setShowDeletedBanner(Boolean(deletedRepo));
  }, [deletedRepo]);

  // Real runs from backend
  const [runs, setRuns] = useState<any[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(true);

  // Keyboard shortcut '/' or 'F' to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" || e.key === "f" || e.key === "F") &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        document.getElementById("project-search-input")?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Initialize starred projects from localStorage only
  useEffect(() => {
    try {
      const stored = localStorage.getItem("autoqa_starred_projects");
      if (stored) {
        setStarredMap(JSON.parse(stored));
      }
    } catch {}
  }, []);

  // Fetch real runs across repositories & external sites
  useEffect(() => {
    async function loadLiveRuns() {
      setIsLoadingRuns(true);
      try {
        const res = await fetch("/api/runs");
        if (res.ok) {
          const data = await res.json();
          if (data.runs && Array.isArray(data.runs)) {
            setRuns(data.runs);
          }
        }
      } catch (err) {
        console.error("Failed to load runs:", err);
      } finally {
        setIsLoadingRuns(false);
      }
    }
    loadLiveRuns();
  }, []);

  const toggleStar = (repoFullName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredMap((prev) => {
      const next = { ...prev, [repoFullName]: !prev[repoFullName] };
      try {
        localStorage.setItem("autoqa_starred_projects", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleSelectProject = (project: ProjectInfo) => {
    setActiveRepo(project.repo_full_name);
    router.push(`/dashboard/project?repo=${encodeURIComponent(project.repo_full_name)}`);
  };

  // Map latest run by repo or external site
  const latestRunByRepo = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of runs) {
      const isExternal = r.scope === "external" || r.branch?.startsWith("http") || r.sha?.startsWith("http");
      if (isExternal) {
        const rawUrl = r.sha?.startsWith("http") ? r.sha : r.branch?.replace("🌐 ", "") || r.result?.target_url || "";
        const host = rawUrl.replace(/^https?:\/\//, "").split("/")[0];
        const key = `external:${host}`;
        if (!map[key] || new Date(r.created_at) > new Date(map[key].created_at)) {
          map[key] = r;
        }
      } else {
        const repoKey = r.repo || r.repo_full_name;
        if (repoKey && (!map[repoKey] || new Date(r.created_at) > new Date(map[repoKey].created_at))) {
          map[repoKey] = r;
        }
      }
    }
    return map;
  }, [runs]);

  // The latest run for a project card. External sites are keyed by host in the
  // map above, so a lookup by repo_full_name alone missed them entirely.
  const latestRunForProject = (project: ProjectInfo) => {
    const direct = latestRunByRepo[project.repo_full_name];
    if (direct) return direct;
    const raw = project.domain || project.target_url || "";
    const host = raw.replace(/^https?:\/\//, "").split("/")[0];
    return host ? latestRunByRepo[`external:${host}`] : undefined;
  };

  const runDetailHref = (run: any) =>
    `/dashboard/runs/${encodeURIComponent(run.id || run.run_id)}`;

  // Real stats calculation
  const gitProjectsCount = projects.filter((p) => p.type !== "external").length;
  const externalProjectsCount = projects.filter((p) => p.type === "external").length;
  const totalRunsCount = runs.length;
  const passedRunsCount = runs.filter((r) => r.status === "passed" || r.result?.status === "success").length;
  const passRate = totalRunsCount > 0 ? ((passedRunsCount / totalRunsCount) * 100).toFixed(0) : "100";

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const name = p.name || p.repo_full_name.split("/")[1] || p.repo_full_name;
      const domain = p.domain || "";
      const latestRun = latestRunByRepo[p.repo_full_name];
      const commitMsg = latestRun?.result?.summary || latestRun?.commit_message || p.last_commit?.message || "";
      const matchesSearch =
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.repo_full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        commitMsg.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      const isStarred = Boolean(starredMap[p.repo_full_name]);
      if (filterType === "starred") return isStarred;
      if (filterType === "git") return p.type !== "external";
      if (filterType === "external") return p.type === "external";
      return true;
    });
  }, [projects, searchQuery, filterType, starredMap, latestRunByRepo]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto w-full space-y-6">
      {/* Deletion confirmation carried over from Project Settings. */}
      {showDeletedBanner && deletedRepo && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 flex items-center justify-between gap-3 shadow-2xs animate-in fade-in-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="truncate">
              <span className="font-bold">Project deleted:</span>{" "}
              <span className="font-mono">{deletedRepo}</span>
              {deletedRuns > 0
                ? ` and ${deletedRuns} stored run${deletedRuns === 1 ? "" : "s"} were removed.`
                : " was removed from the database."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowDeletedBanner(false);
              router.replace("/dashboard/overview");
            }}
            className="text-slate-500 hover:text-slate-900 font-semibold text-xs shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* =========================================================================
          TOP ACTION BAR: SEARCH, FILTER TABS, VIEW SWITCHER & ADD NEW
          ========================================================================= */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="project-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects by name, repo, or domain..."
            className="w-full pl-9 pr-12 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-slate-950 focus:border-transparent transition-all shadow-2xs"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
            /
          </kbd>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Filter Pills */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5 text-xs shadow-2xs">
            <button
              onClick={() => setFilterType("all")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                filterType === "all" ? "bg-white text-slate-950 font-semibold shadow-2xs" : "text-slate-600 hover:text-slate-950"
              }`}
            >
              All ({projects.length})
            </button>
            <button
              onClick={() => setFilterType("git")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                filterType === "git" ? "bg-white text-slate-950 font-semibold shadow-2xs" : "text-slate-600 hover:text-slate-950"
              }`}
            >
              Git Repos ({gitProjectsCount})
            </button>
            <button
              onClick={() => setFilterType("external")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                filterType === "external" ? "bg-white text-slate-950 font-semibold shadow-2xs" : "text-slate-600 hover:text-slate-950"
              }`}
            >
              External Sites ({externalProjectsCount})
            </button>
          </div>

          {/* Grid / List View Toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === "grid" ? "bg-slate-100 text-slate-950 font-semibold" : "text-slate-400 hover:text-slate-700"
              }`}
              title="Grid View"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === "list" ? "bg-slate-100 text-slate-950 font-semibold" : "text-slate-400 hover:text-slate-700"
              }`}
              title="List View"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Add New Dropdown Button */}
          <div className="relative">
            <button
              onClick={() => setIsAddNewOpen(!isAddNewOpen)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-950 text-white hover:bg-slate-800 text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
            >
              <span>Add New</span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {isAddNewOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsAddNewOpen(false)} />
                <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl text-xs space-y-1">
                  <Link
                    href="/dashboard/new"
                    onClick={() => setIsAddNewOpen(false)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-slate-800 hover:bg-slate-50 transition-colors"
                  >
                    <div className="h-6 w-6 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
                      <FolderGit2 className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold block text-slate-900">Import Git Repository</span>
                      <span className="text-[10px] text-slate-500">Connect GitHub repository</span>
                    </div>
                  </Link>
                  <button
                    onClick={() => {
                      setIsAddNewOpen(false);
                      setIsExternalModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-slate-800 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                  >
                    <div className="h-6 w-6 rounded bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
                      <Globe className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold block text-slate-900">External Site Project</span>
                      <span className="text-[10px] text-slate-500">Verify &amp; monitor any live website</span>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          MAIN TWO-COLUMN LAYOUT: REAL STATS / RUNS (LEFT) & PROJECTS (RIGHT)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* =========================================================================
            LEFT COLUMN: REAL PLATFORM STATS & RECENT PREVIEWS FEED
            ========================================================================= */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-4">
          {/* Real Platform Health & Stats Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="font-semibold text-slate-900">Workspace Telemetry</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    engineConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                  }`}
                />
                <span className="text-[10px] font-mono text-slate-600">
                  {engineConnected ? "Engine Active" : "Engine Standby"}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Metric 1: Registered Projects */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <FolderGit2 className="h-3.5 w-3.5 text-slate-500" />
                    Active Projects
                  </span>
                  <span className="font-mono text-slate-900 font-medium">
                    {gitProjectsCount} Git · {externalProjectsCount} External
                  </span>
                </div>
              </div>

              {/* Metric 2: Completed QA Runs */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-indigo-500" />
                    Verified Test Runs
                  </span>
                  <span className="font-mono text-slate-900 font-medium">
                    {totalRunsCount} {totalRunsCount === 1 ? "run" : "runs"}
                  </span>
                </div>
              </div>

              {/* Metric 3: Pass Rate */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Verification Pass Rate
                  </span>
                  <span className="font-mono text-slate-900 font-medium">{passRate}%</span>
                </div>
                {totalRunsCount > 0 && (
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${passRate}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Real Recent Runs / Previews Feed */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-2xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="font-semibold text-slate-900">Recent Previews &amp; Runs</span>
              {runs.length > 0 && (
                <Link href="/dashboard/runs" className="text-[11px] text-slate-500 hover:text-slate-900">
                  View all
                </Link>
              )}
            </div>

            {runs.length === 0 ? (
              <div className="py-6 text-center space-y-2 text-slate-400">
                <Activity className="h-5 w-5 mx-auto text-slate-300" />
                <p className="text-[11px]">No test runs recorded yet.</p>
                <p className="text-[10px] text-slate-400">
                  Runs triggered on your connected projects or external URLs will stream here live.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {runs.slice(0, 5).map((r: any) => {
                  const isExternal = r.scope === "external" || r.branch?.startsWith("http") || r.sha?.startsWith("http");
                  const repoSlug = isExternal
                    ? `external:${(r.sha || r.branch || "").replace(/^https?:\/\//, "").split("/")[0]}`
                    : (r.repo || r.repo_full_name || projects[0]?.repo_full_name || "Workspace");

                  const sha = isExternal ? "external" : (r.sha ? r.sha.slice(0, 7) : "HEAD");
                  const title = r.result?.summary || r.commit_message || (isExternal ? `Verified ${r.branch}` : `Run on ${r.branch || "main"}`);
                  const isPassed = r.status === "passed" || r.result?.status === "success";

                  return (
                    <div
                      key={r.id || r.run_id}
                      onClick={() => {
                        const targetRunId = r.id || r.run_id;
                        router.push(`/dashboard/runs/${encodeURIComponent(targetRunId)}`);
                      }}
                      className="p-2.5 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 cursor-pointer space-y-1.5 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-800 group-hover:text-indigo-600 transition-colors truncate">{title}</span>
                        {isPassed ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Activity className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-mono ${
                          isExternal ? "bg-sky-50 text-sky-700 border border-sky-200" : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}>
                          {isExternal ? "external" : r.branch || "main"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 font-mono">
                          {sha}
                        </span>
                        <span className="text-slate-400 ml-auto font-mono">
                          {r.created_at ? new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* =========================================================================
            RIGHT COLUMN: REAL PROJECTS GRID / LIST
            ========================================================================= */}
        <div className="lg:col-span-8 xl:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Projects</h2>
              <span className="text-[11px] font-mono font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                {filteredProjects.length}
              </span>
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-[11px] text-slate-500 hover:text-slate-900 underline cursor-pointer"
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Grid View */}
          {viewMode === "grid" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProjects.map((p) => {
                const isStarred = Boolean(starredMap[p.repo_full_name]);
                const projectName = p.name || p.repo_full_name.split("/")[1] || p.repo_full_name;
                const isExternal = p.type === "external";
                const latestRun = latestRunForProject(p);
                const commitMsg =
                  latestRun?.result?.summary ||
                  latestRun?.commit_message ||
                  p.last_commit?.message ||
                  latestRun?.result?.rationale ||
                  null;
                const commitDate = latestRun?.created_at
                  ? new Date(latestRun.created_at).toLocaleDateString()
                  : p.last_commit?.date ||
                    (p.updated_at ? new Date(p.updated_at).toLocaleDateString() : null);
                const domain = p.domain || (p.type === "external" ? p.target_url : null);
                const urlBadge = isExternal
                  ? "external"
                  : p.urlSource === "deployment"
                  ? p.urlEnvironment
                    ? `live · ${p.urlEnvironment}`
                    : "live"
                  : p.urlSource === "repository_homepage"
                  ? "GitHub homepage"
                  : null;
                const isPassed = latestRun?.status === "passed" || latestRun?.result?.status === "success";

                return (
                  <div
                    key={p.repo_full_name}
                    onClick={() => handleSelectProject(p)}
                    className="rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs transition-all p-5 cursor-pointer flex flex-col justify-between group relative"
                  >
                    {/* Top Row: Type Icon, Name, Badge, Star, Status */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Clean subtle Icon Container (NO black logo placeholder) */}
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isExternal
                              ? "bg-sky-50 border border-sky-200/80 text-sky-600"
                              : "bg-slate-100 border border-slate-200/80 text-slate-700"
                          }`}>
                            {isExternal ? (
                              <Globe className="h-4 w-4" />
                            ) : (
                              <GithubOctocatIcon className="h-4 w-4" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 group-hover:text-slate-950 transition-colors truncate">
                                {projectName}
                              </span>
                              {isExternal ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 border border-sky-200">
                                  external
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  git
                                </span>
                              )}
                            </div>

                            {/* Live deployment URL (resolved from GitHub) */}
                            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                              {domain ? (
                                <>
                                  <a
                                    href={domain.startsWith("http") ? domain : `https://${domain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs font-mono text-slate-500 hover:text-slate-900 transition-colors truncate max-w-[200px] inline-flex items-center gap-1 group/domain"
                                  >
                                    <span className="hover:underline">{domain}</span>
                                    <ExternalLink className="h-3 w-3 opacity-50 group-hover/domain:opacity-100 shrink-0" />
                                  </a>
                                  {urlBadge && (
                                    <span
                                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${
                                        p.urlSource === "deployment" &&
                                        !/production|live/i.test(p.urlEnvironment || "")
                                          ? "bg-amber-50 text-amber-700 border-amber-200"
                                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      }`}
                                      title={
                                        p.urlSource === "deployment"
                                          ? `Resolved from a GitHub deployment (${p.urlEnvironment || "environment unknown"})`
                                          : "Resolved from the repository's GitHub homepage field"
                                      }
                                    >
                                      {urlBadge}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span
                                  className="text-[11px] text-slate-400 italic"
                                  title="No deployed URL found on GitHub for this repository. Set the repository's homepage on GitHub, or configure a domain in project settings."
                                >
                                  {isExternal ? "No URL" : "Not published"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Star Toggle & Status Pill */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={(e) => toggleStar(p.repo_full_name, e)}
                            className="p-1 rounded text-slate-300 hover:text-amber-400 transition-colors cursor-pointer"
                            title={isStarred ? "Unstar project" : "Star project"}
                          >
                            <Star
                              className={`h-3.5 w-3.5 ${
                                isStarred ? "fill-amber-400 text-amber-400" : "text-slate-300"
                              }`}
                            />
                          </button>

                          {latestRun ? (
                            isPassed ? (
                              <div className="h-6 w-6 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600" title="Verified Green">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </div>
                            ) : (
                              <div className="h-6 w-6 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600" title="Verification Failed">
                                <AlertTriangle className="h-3.5 w-3.5" />
                              </div>
                            )
                          ) : (
                            <SparklineWave />
                          )}
                        </div>
                      </div>

                      {/* Middle: Last Commit / Verification message */}
                      <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0 pt-1">
                        {isExternal ? (
                          <Globe className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                        ) : (
                          <GitCommit className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="truncate font-medium text-[11px]">
                          {commitMsg || (
                            <span className="font-normal italic text-slate-400">
                              No run summary recorded
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Row: Source identifier & Date */}
                    <div className="border-t border-slate-100 pt-3 mt-4 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5 truncate min-w-0">
                        {isExternal ? (
                          <>
                            <Globe className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                            <span className="truncate font-mono text-[11px]">{p.domain || p.name}</span>
                          </>
                        ) : (
                          <>
                            <GithubOctocatIcon className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                            <span className="truncate font-mono text-[11px]">{p.repo_full_name}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {latestRun && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(runDetailHref(latestRun));
                            }}
                            title="Open the detail view for this project's most recent run"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:border-slate-900 hover:bg-slate-950 hover:text-white transition-colors cursor-pointer"
                          >
                            <Play className="h-3 w-3" />
                            Check last run
                          </button>
                        )}
                        <span className="font-mono text-[10px] text-slate-400">· {commitDate || "—"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* List View */}
          {viewMode === "list" && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <tr>
                    <th className="py-2.5 px-4">Project</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Live URL</th>
                    <th className="py-2.5 px-4">Status &amp; Verification</th>
                    <th className="py-2.5 px-4">Last run</th>
                    <th className="py-2.5 px-4 text-right">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProjects.map((p) => {
                    const isStarred = Boolean(starredMap[p.repo_full_name]);
                    const projectName = p.name || p.repo_full_name.split("/")[1] || p.repo_full_name;
                    const isExternal = p.type === "external";
                    const domain = p.domain || p.target_url;
                    const latestRun = latestRunForProject(p);
                    const commitMsg =
                      latestRun?.result?.summary ||
                      latestRun?.commit_message ||
                      p.last_commit?.message ||
                      latestRun?.result?.rationale ||
                      null;
                    const commitDate = latestRun?.created_at
                      ? new Date(latestRun.created_at).toLocaleDateString()
                      : p.last_commit?.date ||
                        (p.updated_at ? new Date(p.updated_at).toLocaleDateString() : null);
                    const isPassed = latestRun?.status === "passed" || latestRun?.result?.status === "success";

                    return (
                      <tr
                        key={p.repo_full_name}
                        onClick={() => handleSelectProject(p)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={(e) => toggleStar(p.repo_full_name, e)}
                              className="text-slate-300 hover:text-amber-400 cursor-pointer"
                            >
                              <Star
                                className={`h-3.5 w-3.5 ${
                                  isStarred ? "fill-amber-400 text-amber-400" : "text-slate-300"
                                }`}
                              />
                            </button>
                            <div className={`h-6 w-6 rounded flex items-center justify-center ${
                              isExternal ? "bg-sky-50 text-sky-600 border border-sky-200" : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}>
                              {isExternal ? <Globe className="h-3 w-3" /> : <GithubOctocatIcon className="h-3 w-3" />}
                            </div>
                            <span className="font-semibold text-slate-900">{projectName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            isExternal ? "bg-sky-50 text-sky-700 border border-sky-200" : "bg-slate-100 text-slate-600 border border-slate-200"
                          }`}>
                            {isExternal ? "external" : "git"}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          {domain ? (
                            <a
                              href={domain.startsWith("http") ? domain : `https://${domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-slate-900 transition-colors truncate max-w-[180px] inline-block"
                            >
                              {domain}
                            </a>
                          ) : (
                            <span className="text-slate-400 italic">
                              {isExternal ? "No URL" : "Not published"}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-700 truncate max-w-[200px]">
                          {commitMsg || (
                            <span className="italic text-slate-400">No run summary recorded</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {latestRun ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(runDetailHref(latestRun));
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:border-slate-900 hover:bg-slate-950 hover:text-white transition-colors cursor-pointer"
                            >
                              <Play className="h-3 w-3" />
                              Check last run
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">No runs</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-400">
                          {commitDate || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filteredProjects.length === 0 && !isLoadingProjects && (
            <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center space-y-3">
              <FolderGit2 className="h-8 w-8 text-slate-400 mx-auto" />
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {searchQuery ? "No matching projects found" : "No projects configured"}
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {searchQuery
                    ? `No projects match your search query "${searchQuery}".`
                    : "Import a GitHub repository or add an external live website to start automated testing and monitoring."}
                </p>
              </div>
              <div className="pt-2 flex items-center justify-center gap-2">
                <Link
                  href="/dashboard/new"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-950 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shadow-2xs"
                >
                  <FolderGit2 className="h-3.5 w-3.5" />
                  <span>Import Git Repository</span>
                </Link>
                <button
                  onClick={() => setIsExternalModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 text-sky-600" />
                  <span>Verify External Site</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* External Test Modal */}
      <ExternalTestModal
        isOpen={isExternalModalOpen}
        onClose={() => setIsExternalModalOpen(false)}
        onSuccess={() => {
          setIsExternalModalOpen(false);
          refreshProjects();
        }}
      />
    </div>
  );
}
