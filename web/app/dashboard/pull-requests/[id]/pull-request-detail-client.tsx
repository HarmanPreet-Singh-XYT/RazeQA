"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Video,
  XCircle,
} from "lucide-react";

/**
 * One pull request: a filterable list of test cases on the left and the full
 * detail — severity, impact, reproduction steps, code analysis, mock context,
 * evidence — on the right. Findings can be dismissed so a judged issue stops
 * being reported.
 */

type TestCase = {
  id: string;
  name: string;
  route: string | null;
  status: "passed" | "failed" | "skipped";
  category: string;
  severity: string | null;
  impact: string | null;
  failure_reason: string | null;
  reproduction_steps: string[];
  code_analysis: { surface?: string; note?: string; route?: string }[];
  mock_context: string[];
  evidence: {
    video_url?: string | null;
    trace_url?: string | null;
    screenshot_url?: string | null;
    duration_ms?: number | null;
    console_errors?: string[];
    network_requests?: number;
    broken_links?: { url: string; status: number }[];
  };
  origin: string;
  verified_this_commit: boolean;
};

type Finding = {
  id: string;
  severity: string;
  category: string | null;
  title: string;
  detail: string | null;
  route: string | null;
  status: string;
  occurrences: number;
  dismiss_reason: string | null;
};

type Payload = {
  pull_request: {
    id: string;
    repo_full_name: string;
    pr_number: number;
    title: string | null;
    author_login: string | null;
    state: string;
    is_draft: boolean;
    html_url: string | null;
    head_branch: string | null;
    base_branch: string;
    head_sha: string | null;
    added_lines: number | null;
    removed_lines: number | null;
    changed_files: number | null;
  };
  run: {
    id: string;
    status: string;
    result_status: string | null;
    severity_summary: { counts?: Record<string, number>; total_cases?: number; passed?: number; failed?: number; skipped?: number } | null;
    change_impact: { kind?: string; rationale?: string } | null;
    environment_context: { variable_names?: string[]; secret_names?: string[]; seed_names?: string[] } | null;
    video_url: string | null;
    trace_url: string | null;
    completed_at: string | null;
  } | null;
  test_cases: TestCase[];
  findings: Finding[];
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-rose-100 text-rose-800 border-rose-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

const ORIGIN_LABEL: Record<string, string> = {
  new: "New",
  regression: "Regression",
  still_broken_verified: "Still broken (verified)",
  still_broken_inherited: "Still broken (inherited)",
  carried_forward: "Carried forward",
  fixed: "Fixed",
};

export function PullRequestDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "passed" | "failed" | "additional">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyFinding, setBusyFinding] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedCaseIds, setSavedCaseIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pull-requests/${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Could not load this pull request (HTTP ${res.status}).`);
        setData(null);
        return;
      }
      setData(body);
      const firstFailed = (body.test_cases || []).find((c: TestCase) => c.status === "failed");
      setSelectedId(firstFailed?.id ?? (body.test_cases || [])[0]?.id ?? null);
    } catch (err: any) {
      setError(err?.message || "Could not reach the AutoQA server.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const cases = data?.test_cases || [];
  const failures = useMemo(() => cases.filter((c) => c.status === "failed"), [cases]);
  const openFindings = useMemo(
    () => (data?.findings || []).filter((f) => f.status === "open"),
    [data]
  );
  const dismissedFindings = useMemo(
    () => (data?.findings || []).filter((f) => f.status !== "open"),
    [data]
  );

  const filtered = useMemo(() => {
    if (filter === "passed") return cases.filter((c) => c.status === "passed");
    if (filter === "failed") return cases.filter((c) => c.status === "failed");
    if (filter === "additional") return cases.filter((c) => c.category === "visual" || c.status === "skipped");
    return cases;
  }, [cases, filter]);

  const selected = filtered.find((c) => c.id === selectedId) || cases.find((c) => c.id === selectedId) || null;

  const saveAsTest = async (testCase: TestCase) => {
    if (!data) return;
    setSavingId(testCase.id);
    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: data.pull_request.repo_full_name,
          name: testCase.route || testCase.name,
          route: testCase.route,
          category: testCase.category,
          intent:
            testCase.failure_reason ||
            testCase.impact ||
            `Exercise ${testCase.route || testCase.name}`,
          preconditions: testCase.mock_context || [],
          source_run_id: data.run?.id ?? null,
          source_case_id: testCase.id,
        }),
      });
      if (res.ok) {
        setSavedCaseIds((prev) => new Set(prev).add(testCase.id));
      } else {
        const responseBody = await res.json().catch(() => ({}));
        setError(responseBody?.error || "Could not save this test.");
      }
    } finally {
      setSavingId(null);
    }
  };

  const setFindingStatus = async (findingId: string, status: string) => {
    setBusyFinding(findingId);
    try {
      const res = await fetch(`/api/findings/${encodeURIComponent(findingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                findings: prev.findings.map((f) => (f.id === findingId ? { ...f, status } : f)),
              }
            : prev
        );
      }
    } finally {
      setBusyFinding(null);
    }
  };

  if (isLoading && !data) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
        Loading pull request…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/dashboard/pull-requests" className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> All pull requests
        </Link>
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error || "Pull request not found."}</span>
        </div>
      </div>
    );
  }

  const pr = data.pull_request;
  const summary = data.run?.severity_summary;
  const env = data.run?.environment_context;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-7xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="min-w-0 space-y-1">
          <Link
            href="/dashboard/pull-requests"
            className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All pull requests
          </Link>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">
            {pr.title || `Pull request #${pr.pr_number}`}
          </h1>
          <p className="text-[11px] text-slate-500 font-mono">
            {pr.repo_full_name} #{pr.pr_number} · {pr.author_login || "unknown"} · {pr.head_branch} →{" "}
            {pr.base_branch}
            {pr.head_sha ? ` · ${pr.head_sha.slice(0, 7)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pr.html_url && (
            <a
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              GitHub <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={load}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Run summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Result</span>
          <div className="text-sm font-bold">
            {data.run?.result_status === "success"
              ? "Passed"
              : data.run?.result_status === "inconclusive"
              ? "Inconclusive"
              : data.run?.result_status === "failure"
              ? "Failed"
              : data.run
              ? "Running"
              : "Not tested"}
          </div>
        </div>
        {(["critical", "high", "medium", "low"] as const).map((level) => (
          <div key={level} className="rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{level}</span>
            <div className="text-sm font-bold font-mono">{summary?.counts?.[level] ?? 0}</div>
          </div>
        ))}
      </div>

      {data.run?.change_impact?.kind && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-800">Why this scope: </span>
          {data.run.change_impact.kind}
          {data.run.change_impact.rationale ? ` — ${data.run.change_impact.rationale}` : ""}
        </div>
      )}

      {env && ((env.variable_names?.length || 0) + (env.secret_names?.length || 0) + (env.seed_names?.length || 0) > 0) && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-600 space-y-1">
          <span className="font-semibold text-slate-800 block">Repository context used</span>
          {env.variable_names?.length ? <div>Variables: <span className="font-mono">{env.variable_names.join(", ")}</span></div> : null}
          {env.secret_names?.length ? <div>Secrets: <span className="font-mono">{env.secret_names.join(", ")}</span> (values never shown)</div> : null}
          {env.seed_names?.length ? <div>Seed data: <span className="font-mono">{env.seed_names.join(", ")}</span></div> : null}
        </div>
      )}

      {/* Split panel */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Left: cases */}
          <div className="lg:col-span-5 xl:col-span-4">
            <div className="p-3 border-b border-slate-200 bg-slate-50/70">
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["all", `All (${cases.length})`],
                  ["passed", `Passed (${cases.filter((c) => c.status === "passed").length})`],
                  ["failed", `Failed (${failures.length})`],
                  ["additional", `Other (${cases.filter((c) => c.category === "visual" || c.status === "skipped").length})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                      filter === key
                        ? "border-slate-900 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[620px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No test cases in this filter.</p>
              ) : (
                filtered.map((testCase) => {
                  const isSelected = selected?.id === testCase.id;
                  return (
                    <button
                      key={testCase.id}
                      onClick={() => setSelectedId(testCase.id)}
                      className={`w-full text-left p-3 transition-colors ${
                        isSelected ? "bg-slate-100/90" : "hover:bg-slate-50/80"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {testCase.status === "passed" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        ) : testCase.status === "failed" ? (
                          <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-semibold text-slate-900 block truncate font-mono">
                            {testCase.route || testCase.name}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                              {testCase.category}
                            </span>
                            {testCase.severity && (
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                  SEVERITY_BADGE[testCase.severity] || SEVERITY_BADGE.low
                                }`}
                              >
                                {testCase.severity}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400">
                              {ORIGIN_LABEL[testCase.origin] || testCase.origin}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="lg:col-span-7 xl:col-span-8 p-4 space-y-4">
            {!selected ? (
              <p className="text-xs text-slate-500">Select a test case to see its evidence.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-slate-900 font-mono">
                    {selected.route || selected.name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-semibold text-slate-600">
                      {selected.status}
                    </span>
                    <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500">
                      {selected.category}
                    </span>
                    {selected.severity && (
                      <span className={`rounded border px-1.5 py-0.5 font-bold uppercase ${SEVERITY_BADGE[selected.severity] || SEVERITY_BADGE.low}`}>
                        {selected.severity}
                      </span>
                    )}
                    <span className="text-slate-400">{ORIGIN_LABEL[selected.origin] || selected.origin}</span>
                  </div>
                </div>

                {selected.impact && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-700">
                    <span className="font-semibold block mb-0.5">Impact</span>
                    {selected.impact}
                  </div>
                )}

                {selected.failure_reason && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
                    <span className="font-semibold block mb-0.5">What failed</span>
                    {selected.failure_reason}
                  </div>
                )}

                {selected.reproduction_steps.length > 0 && (
                  <details open className="rounded-lg border border-slate-200 bg-white p-3">
                    <summary className="text-xs font-semibold text-slate-800 cursor-pointer">
                      Reproduction steps
                    </summary>
                    <ol className="mt-2 space-y-1 list-decimal pl-5 text-[11px] text-slate-600">
                      {selected.reproduction_steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </details>
                )}

                {selected.code_analysis.length > 0 && (
                  <details className="rounded-lg border border-slate-200 bg-white p-3">
                    <summary className="text-xs font-semibold text-slate-800 cursor-pointer">
                      Code analysis
                    </summary>
                    <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                      {selected.code_analysis.map((entry, index) => (
                        <li key={index} className="font-mono">
                          {entry.surface || entry.note || entry.route}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {selected.mock_context.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                    <span className="font-semibold block mb-1">Environment context</span>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {selected.mock_context.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[10px] text-amber-800/80">
                      A failure caused by the environment rather than the change should be judged against this.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => saveAsTest(selected)}
                    disabled={savingId === selected.id || savedCaseIds.has(selected.id)}
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60 ${
                      savedCaseIds.has(selected.id)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-900 bg-slate-950 text-white hover:bg-slate-800"
                    }`}
                  >
                    <ListChecks className="h-3 w-3" />
                    {savedCaseIds.has(selected.id)
                      ? "Saved to tests"
                      : savingId === selected.id
                      ? "Saving…"
                      : "Save as test"}
                  </button>
                  {selected.evidence.video_url && (
                    <a
                      href={selected.evidence.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Video className="h-3 w-3 text-slate-600" /> Video replay
                    </a>
                  )}
                  {selected.evidence.trace_url && (
                    <a
                      href={selected.evidence.trace_url}
                      download
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3 w-3 text-sky-600" /> Trace
                    </a>
                  )}
                  {selected.evidence.screenshot_url && (
                    <a
                      href={selected.evidence.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3 w-3 text-emerald-600" /> Screenshot
                    </a>
                  )}
                  {typeof selected.evidence.duration_ms === "number" && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      {(selected.evidence.duration_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                  {typeof selected.evidence.network_requests === "number" && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      {selected.evidence.network_requests} requests
                    </span>
                  )}
                </div>

                {selected.evidence.broken_links && selected.evidence.broken_links.length > 0 && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
                    <span className="font-semibold block mb-1">Broken links</span>
                    <ul className="list-disc pl-4 space-y-0.5 font-mono">
                      {selected.evidence.broken_links.map((link, index) => (
                        <li key={index}>
                          {link.url} (HTTP {link.status})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selected.evidence.console_errors && selected.evidence.console_errors.length > 0 && (
                  <details className="rounded-lg border border-slate-200 bg-slate-900 p-3">
                    <summary className="text-xs font-semibold text-slate-100 cursor-pointer">
                      Console errors ({selected.evidence.console_errors.length})
                    </summary>
                    <pre className="mt-2 text-[10px] text-slate-200 overflow-x-auto whitespace-pre-wrap">
                      {selected.evidence.console_errors.join("\n")}
                    </pre>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Findings */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-950">Findings for this repository</h2>
          <span className="text-[11px] text-slate-500 font-mono">
            {openFindings.length} open · {dismissedFindings.length} dismissed
          </span>
        </div>
        {openFindings.length === 0 && dismissedFindings.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600 inline mr-1.5" />
            No findings recorded.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...openFindings, ...dismissedFindings].map((finding) => (
              <li key={finding.id} className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        SEVERITY_BADGE[finding.severity] || SEVERITY_BADGE.low
                      }`}
                    >
                      {finding.severity}
                    </span>
                    {finding.route && (
                      <span className="font-mono text-[11px] text-slate-600">{finding.route}</span>
                    )}
                    {finding.status !== "open" && (
                      <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {finding.status}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">seen {finding.occurrences}×</span>
                  </div>
                  <p className="text-xs text-slate-800 mt-1">{finding.title}</p>
                  {finding.detail && (
                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{finding.detail}</p>
                  )}
                </div>
                <button
                  disabled={busyFinding === finding.id}
                  onClick={() => setFindingStatus(finding.id, finding.status === "open" ? "dismissed" : "open")}
                  className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
                    finding.status === "open"
                      ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      : "border-slate-300 bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {finding.status === "open" ? "Dismiss" : "Reopen"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
