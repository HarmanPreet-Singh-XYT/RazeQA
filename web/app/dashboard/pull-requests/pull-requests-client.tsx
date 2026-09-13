"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ExternalLink, GitPullRequest, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useDashboard } from "@/components/dashboard-context";

/**
 * The primary screen: every pull request the engine has tested, ranked by what
 * needs attention before merge. Severity counts come from the run's structured
 * test cases, never from a rollup of journey names.
 */

type SeverityCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  verified_total?: number;
  carried_forward?: number;
  carried_forward_failing?: number;
};

type PullRequestRow = {
  id: string;
  repo_full_name: string;
  repo_label: string;
  pr_number: number;
  title: string | null;
  author_login: string | null;
  author_type: string;
  state: string;
  is_draft: boolean;
  head_branch: string | null;
  html_url: string | null;
  opened_at: string | null;
  tested_at: string | null;
  added_lines: number | null;
  removed_lines: number | null;
  changed_files: number | null;
  run: {
    id: string;
    status: string;
    result_status: string | null;
    completed_at: string | null;
  } | null;
  counts: SeverityCounts;
  has_bugs: boolean;
  highest_severity: string | null;
};

type AvailablePR = {
  pr_number: number;
  title: string | null;
  author_login: string | null;
  author_type: string;
  is_draft: boolean;
  head_branch: string | null;
  head_sha: string | null;
  base_branch: string | null;
  html_url: string | null;
  updated_at: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  created_at: string | null;
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-rose-100 text-rose-800 border-rose-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

function SeverityPill({ severity, count }: { severity: string; count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold font-mono ${
        SEVERITY_STYLES[severity] || SEVERITY_STYLES.low
      }`}
    >
      {count} {severity}
    </span>
  );
}

function relativeTime(value: string | null): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PullRequestsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projects } = useDashboard();

  const [rows, setRows] = useState<PullRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [counts, setCounts] = useState<{ total: number; with_bugs: number }>({ total: 0, with_bugs: 0 });
  const [detectionRate, setDetectionRate] = useState<number | null>(null);

  const [state, setState] = useState("all");
  const [period, setPeriod] = useState("30d");
  const [author, setAuthor] = useState("");
  const [repo, setRepo] = useState(searchParams.get("repo") || "");

  // Manual selection: pick open PRs and dispatch verification for them.
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerRepo, setPickerRepo] = useState("");
  const [availablePRs, setAvailablePRs] = useState<AvailablePR[]>([]);
  const [selectedPRs, setSelectedPRs] = useState<Set<number>>(new Set());
  const [isLoadingPRs, setIsLoadingPRs] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [dispatchSummary, setDispatchSummary] = useState<string | null>(null);
  const [pickerScope, setPickerScope] = useState<"changed" | "full">("changed");
  const [pickerTestType, setPickerTestType] = useState<"functional" | "functional + visual">("functional");

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ state, period });
      if (author.trim()) params.set("author", author.trim());
      if (repo.trim()) params.set("repo", repo.trim());
      const res = await fetch(`/api/pull-requests?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not load pull requests (HTTP ${res.status}).`);
        setRows([]);
        return;
      }
      setMigrationRequired(Boolean(data?.migration_required));
      setRows(Array.isArray(data?.pull_requests) ? data.pull_requests : []);
      setCounts(data?.counts || { total: 0, with_bugs: 0 });
      setDetectionRate(typeof data?.bug_detection_rate === "number" ? data.bug_detection_rate : null);
    } catch (err: any) {
      setError(err?.message || "Could not reach the AutoQA server.");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, period, repo]);

  const loadAvailablePRs = async (target: string) => {
    if (!target) return;
    setIsLoadingPRs(true);
    setPickerError(null);
    setSelectedPRs(new Set());
    try {
      const res = await fetch(
        `/api/github/pull-requests?repo=${encodeURIComponent(target)}&state=open`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPickerError(data?.error || `Could not list pull requests (HTTP ${res.status}).`);
        setAvailablePRs([]);
        return;
      }
      setAvailablePRs(Array.isArray(data?.pull_requests) ? data.pull_requests : []);
    } catch (err: any) {
      setPickerError(err?.message || "Could not reach the AutoQA server.");
      setAvailablePRs([]);
    } finally {
      setIsLoadingPRs(false);
    }
  };

  const openPicker = () => {
    setDispatchSummary(null);
    setPickerError(null);
    setSelectedPRs(new Set());
    setIsPickerOpen(true);
    const target =
      pickerRepo ||
      repo ||
      projects.find((project) => project.type !== "external")?.repo_full_name ||
      "";
    if (target) {
      setPickerRepo(target);
      void loadAvailablePRs(target);
    }
  };

  const togglePR = (prNumber: number) => {
    setSelectedPRs((prev) => {
      const next = new Set(prev);
      if (next.has(prNumber)) next.delete(prNumber);
      else next.add(prNumber);
      return next;
    });
  };

  const dispatchSelected = async () => {
    if (!pickerRepo || selectedPRs.size === 0) return;
    setIsDispatching(true);
    setPickerError(null);
    setDispatchSummary(null);
    try {
      const chosen = availablePRs.filter((pr) => selectedPRs.has(pr.pr_number));
      const res = await fetch("/api/pull-requests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: pickerRepo,
          scope: pickerScope,
          test_type: pickerTestType,
          pull_requests: chosen.map((pr) => ({
            pr_number: pr.pr_number,
            title: pr.title,
            author_login: pr.author_login,
            author_type: pr.author_type,
            is_draft: pr.is_draft,
            head_branch: pr.head_branch,
            head_sha: pr.head_sha,
            base_branch: pr.base_branch,
            html_url: pr.html_url,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
            opened_at: pr.created_at,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPickerError(data?.error || `Could not dispatch runs (HTTP ${res.status}).`);
        return;
      }
      const failed = (data?.results || []).filter(
        (result: any) => result.status === "failed" || result.status === "skipped"
      );
      setDispatchSummary(
        `${data?.queued ?? 0} of ${data?.requested ?? chosen.length} run(s) queued.` +
          (failed.length ? ` ${failed.length} could not be started.` : "")
      );
      setSelectedPRs(new Set());
      await load();
    } catch (err: any) {
      setPickerError(err?.message || "Could not reach the AutoQA server.");
    } finally {
      setIsDispatching(false);
    }
  };

  const severityTotals = useMemo(() => {
    const totals = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of rows) {
      totals.critical += row.counts.critical;
      totals.high += row.counts.high;
      totals.medium += row.counts.medium;
      totals.low += row.counts.low;
    }
    return totals;
  }, [rows]);

  const repoOptions = useMemo(() => {
    const names = new Set<string>();
    projects.forEach((p) => names.add(p.repo_full_name));
    rows.forEach((r) => names.add(r.repo_full_name));
    return Array.from(names).sort();
  }, [projects, rows]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitPullRequest className="h-5 w-5 text-slate-700" />
            Pull Requests
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
            Every pull request tested at runtime, ranked by severity. A result only counts as a
            failure when a test case actually failed; carried-forward and skipped cases are listed
            separately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openPicker}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            Run on pull requests
          </button>
          <button
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {migrationRequired && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            The pull-request tables are not present in this database yet. Apply
            <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">
              supabase/migrations/20260913000000_pr_centric_model.sql
            </code>
            to enable runtime QA reporting per pull request.
          </span>
        </div>
      )}

      {/* Severity is the primary triage signal, so it leads the page. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["critical", "high", "medium", "low"] as const).map((level) => (
          <div key={level} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              {level}
            </span>
            <span className="text-2xl font-bold font-mono text-slate-900">{severityTotals[level]}</span>
            <span className="block text-[10px] text-slate-400 mt-0.5">
              failed test case{severityTotals[level] === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pull requests</span>
          <div className="text-lg font-bold font-mono text-slate-900">{counts.total}</div>
          <span className="text-[10px] text-slate-500">in the selected window</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Bug detection rate
          </span>
          <div className="text-lg font-bold font-mono text-slate-900">
            {detectionRate === null ? "—" : `${detectionRate}%`}
          </div>
          <span className="text-[10px] text-slate-500">
            {detectionRate === null
              ? "no pull requests tested yet"
              : `${counts.with_bugs} of ${counts.total} PRs had at least one failure`}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clean PRs</span>
          <div className="text-lg font-bold font-mono text-emerald-700 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {Math.max(0, counts.total - counts.with_bugs)}
          </div>
          <span className="text-[10px] text-slate-500">no failed test cases</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer"
        >
          <option value="">All repositories</option>
          {repoOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer"
        >
          <option value="all">Any state</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="merged">Merged</option>
        </select>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        <div className="relative">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
            placeholder="Filter by author…"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 w-44"
          />
        </div>
        <button
          onClick={load}
          className="rounded-md border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Apply
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 font-semibold">Pull request</th>
                <th className="px-3 py-2.5 font-semibold">Opened</th>
                <th className="px-3 py-2.5 font-semibold">Tested</th>
                <th className="px-3 py-2.5 font-semibold">State</th>
                <th className="px-3 py-2.5 font-semibold">Results</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                    <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
                    Loading pull requests…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                    <Sparkles className="h-5 w-5 mx-auto mb-2 text-slate-400" />
                    No pull requests have been tested yet. Open or update a pull request in an
                    imported repository and it will appear here.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/dashboard/pull-requests/${row.id}`)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900 block truncate max-w-[420px]">
                            {row.title || `Pull request #${row.pr_number}`}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {row.repo_full_name} #{row.pr_number} · {row.author_login || "unknown"}
                            {row.author_type === "bot" ? " (bot)" : ""}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600 whitespace-nowrap">
                      {relativeTime(row.opened_at)}
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600 whitespace-nowrap">
                      {row.run?.status === "running" || row.run?.status === "queued" ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Running…
                        </span>
                      ) : (
                        relativeTime(row.tested_at)
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {row.state}
                        </span>
                        {row.is_draft && (
                          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                            draft
                          </span>
                        )}
                        {row.html_url && (
                          <a
                            href={row.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.counts.total === 0 ? (
                          <span className="text-[10px] text-slate-400">not tested</span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold font-mono text-emerald-700">
                              {row.counts.passed} passed
                            </span>
                            <SeverityPill severity="critical" count={row.counts.critical} />
                            <SeverityPill severity="high" count={row.counts.high} />
                            <SeverityPill severity="medium" count={row.counts.medium} />
                            <SeverityPill severity="low" count={row.counts.low} />
                            {row.counts.skipped > 0 && (
                              <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                                {row.counts.skipped} skipped
                              </span>
                            )}
                            {(row.counts.carried_forward ?? 0) > 0 && (
                              <span
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500"
                                title="Cases the diff did not touch. Listed, but not re-verified on this commit."
                              >
                                ↪ {row.counts.carried_forward} carried forward
                                {(row.counts.carried_forward_failing ?? 0) > 0
                                  ? ` (${row.counts.carried_forward_failing} failing)`
                                  : ""}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Need to change whether a repository is reviewed, or whether draft and bot PRs are included?{" "}
        <Link href="/dashboard/projects" className="underline hover:text-slate-700">
          Open repository settings
        </Link>
        .
      </p>

      {isPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pr-picker-title"
            className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl my-auto"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h2 id="pr-picker-title" className="text-base font-bold text-slate-950">
                  Run verification on pull requests
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pick the pull requests to test. Each one is queued against its current head commit.
                </p>
              </div>
              <button
                onClick={() => setIsPickerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={pickerRepo}
                  onChange={(e) => {
                    setPickerRepo(e.target.value);
                    void loadAvailablePRs(e.target.value);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer min-w-[240px]"
                >
                  <option value="">Select a repository…</option>
                  {repoOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={pickerScope}
                  onChange={(e) => setPickerScope(e.target.value as "changed" | "full")}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer"
                >
                  <option value="changed">Changed surfaces</option>
                  <option value="full">Full sweep</option>
                </select>
                <select
                  value={pickerTestType}
                  onChange={(e) =>
                    setPickerTestType(e.target.value as "functional" | "functional + visual")
                  }
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer"
                >
                  <option value="functional">Functional</option>
                  <option value="functional + visual">Functional + visual</option>
                </select>
              </div>

              {pickerError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{pickerError}</span>
                </div>
              )}
              {dispatchSummary && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  {dispatchSummary}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 max-h-80 overflow-y-auto divide-y divide-slate-100">
                {isLoadingPRs ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin inline mr-2" />
                    Loading open pull requests…
                  </p>
                ) : !pickerRepo ? (
                  <p className="p-6 text-center text-xs text-slate-500">Select a repository first.</p>
                ) : availablePRs.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    No open pull requests in this repository.
                  </p>
                ) : (
                  availablePRs.map((pr) => (
                    <label
                      key={pr.pr_number}
                      className="flex items-start gap-2.5 p-3 cursor-pointer hover:bg-slate-50/80"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPRs.has(pr.pr_number)}
                        onChange={() => togglePR(pr.pr_number)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-slate-900 truncate max-w-[420px]">
                            {pr.title || `Pull request #${pr.pr_number}`}
                          </span>
                          {pr.is_draft && (
                            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                              draft
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono">
                          #{pr.pr_number} · {pr.author_login || "unknown"} · {pr.head_branch}
                          {pr.changed_files != null ? ` · ${pr.changed_files} files` : ""}
                        </span>
                      </div>
                    </label>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="text-[11px] text-slate-500">
                  {selectedPRs.size} selected · up to 10 per run request
                </span>
                <button
                  onClick={dispatchSelected}
                  disabled={isDispatching || selectedPRs.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isDispatching ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Dispatching…
                    </>
                  ) : (
                    <>Run verification</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
