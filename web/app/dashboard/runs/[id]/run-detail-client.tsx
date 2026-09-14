"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  GitPullRequest,
  Loader2,
  MinusCircle,
  RefreshCw,
  Terminal,
  Video,
} from "lucide-react";
import { CustomVideoPlayer } from "@/components/custom-video-player";

/**
 * One test run, in the same shape a reviewer thinks about it:
 *
 *   left  — every test case the run executed, with the failing ones expanded
 *           inline to their description and impact.
 *   right — the recording plus the evidence that explains the case:
 *           reproduction steps, stub/mock context, code analysis, assets.
 *
 * The Analytics button hands off to the deeper per-path quality report rather
 * than duplicating it here.
 */

type TestCase = {
  id: string;
  name: string;
  route: string | null;
  status: "passed" | "failed" | "skipped" | string;
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
    build_output?: string | null;
  };
  origin: string;
};

type RunPayload = {
  id: string;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  scope: string;
  test_type: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  result_status: string | null;
  error: string | null;
  failure_kind: string | null;
  build_log: string | null;
  summary: string | null;
  duration_s: number | null;
  severity_summary: { counts?: Record<string, number>; passed?: number; failed?: number; skipped?: number } | null;
  change_impact: { kind?: string; rationale?: string } | null;
  environment_context: { variable_names?: string[]; secret_names?: string[]; seed_names?: string[] } | null;
  video_url: string | null;
  trace_url: string | null;
  screenshot_url: string | null;
  console_errors: string[];
  pr_number: number | null;
  pr_title: string | null;
  pr_author: string | null;
  pr_url: string | null;
  pr_state: string | null;
  pr_head_branch: string | null;
  pr_base_branch: string | null;
  pr_opened_at: string | null;
};

type Payload = { run: RunPayload; test_cases: TestCase[] };

const CATEGORY_STYLE: Record<string, string> = {
  build: "bg-rose-50 text-rose-700 border-rose-200",
  adversarial: "bg-orange-50 text-orange-700 border-orange-200",
  accessibility: "bg-violet-50 text-violet-700 border-violet-200",
  mobile: "bg-sky-50 text-sky-700 border-sky-200",
  visual: "bg-amber-50 text-amber-700 border-amber-200",
  happy_path: "bg-slate-50 text-slate-600 border-slate-200",
  logic: "bg-slate-50 text-slate-600 border-slate-200",
};

/** Engine artifact paths are `/artifacts/runs/…`; the browser reads them
 * through the token-holding proxy at `/api/artifacts/runs/…`. */
function artifactUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) return url;
  if (url.startsWith("/artifacts/")) return `/api${url}`;
  return undefined;
}

function relativeTime(value?: string | null): string {
  if (!value) return "unknown";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function RunDetailClient({ runId }: { runId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "failed" | "passed" | "other">("all");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [copiedLog, setCopiedLog] = useState(false);

  const load = async (showSpinner = true) => {
    if (showSpinner) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Could not load this run (HTTP ${res.status}).`);
        setData(null);
        return;
      }
      setData(body);
      setSelectedId((prev) => prev ?? body.test_cases?.[0]?.id ?? null);
    } catch (err: any) {
      setError(err?.message || "Could not reach the RazeQA server.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const cancelRun = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelError(
          body?.error || body?.detail || `Could not cancel this run (HTTP ${res.status}).`
        );
        return;
      }
      await load(false);
    } catch (err: any) {
      setCancelError(err?.message || "Could not reach the RazeQA server.");
    } finally {
      setCancelling(false);
    }
  };

  const cases = data?.test_cases || [];
  const isLive = data?.run.status === "running" || data?.run.status === "queued";

  // A run still executing fills in as it goes.
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => load(false), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  const counts = useMemo(
    () => ({
      passed: cases.filter((c) => c.status === "passed").length,
      failed: cases.filter((c) => c.status === "failed").length,
      skipped: cases.filter((c) => c.status !== "passed" && c.status !== "failed").length,
    }),
    [cases]
  );

  const filtered = useMemo(() => {
    if (filter === "passed") return cases.filter((c) => c.status === "passed");
    if (filter === "failed") return cases.filter((c) => c.status === "failed");
    if (filter === "other") return cases.filter((c) => c.status !== "passed" && c.status !== "failed");
    return cases;
  }, [cases, filter]);

  const selected = cases.find((c) => c.id === selectedId) || null;

  if (isLoading && !data) {
    return (
      <div className="p-10 text-center text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        Loading test run…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link
          href="/dashboard/runs"
          className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All test runs
        </Link>
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error || "Run not found."}</span>
        </div>
      </div>
    );
  }

  const run = data.run;
  const runVideo = artifactUrl(run.video_url);
  const activeVideo = artifactUrl(selected?.evidence?.video_url) || runVideo;
  const passed = run.result_status === "success";
  const failed = run.result_status === "failure";
  const inconclusive = run.result_status === "inconclusive";

  // What a developer needs to debug the run: the build/boot output the engine
  // captured, plus the engine's own error, plus runtime console errors from the
  // journeys. This is the dashboard equivalent of a CI build log.
  const buildLog = (run.build_log || selected?.evidence?.build_output || "").trim();
  const consoleErrors = Array.from(
    new Set([
      ...(run.console_errors || []),
      ...cases.flatMap((c) => c.evidence?.console_errors || []),
    ])
  );
  const logText = [
    run.failure_kind ? `# failure: ${run.failure_kind.replace(/_/g, " ")}` : null,
    run.error ? `# ${run.error}` : null,
    buildLog ? `\n${buildLog}` : null,
    consoleErrors.length ? `\n# console errors (${consoleErrors.length})\n${consoleErrors.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const hasLogs = logText.trim().length > 0;

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(logText);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 1500);
    } catch {
      // Clipboard can be unavailable in insecure contexts; the log is still
      // selectable and downloadable.
    }
  };

  const downloadLog = () => {
    const blob = new Blob([logText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.id}-build.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const assets = [
    {
      label: "Recording",
      value: selected?.evidence?.video_url || run.video_url,
      url: activeVideo,
      download: false,
    },
    {
      label: "Trace",
      value: selected?.evidence?.trace_url || run.trace_url,
      url: artifactUrl(selected?.evidence?.trace_url || run.trace_url),
      download: true,
    },
    {
      label: "Screenshot",
      value: selected?.evidence?.screenshot_url || run.screenshot_url,
      url: artifactUrl(selected?.evidence?.screenshot_url || run.screenshot_url),
      download: false,
    },
  ].filter((a) => Boolean(a.url));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto w-full text-slate-900 animate-in fade-in-50">
      {/* ============================ HEADER ============================ */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="min-w-0 space-y-1.5">
          <Link
            href="/dashboard/runs"
            className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All test runs
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight min-w-0">
              {run.pr_title || run.summary || `Test run ${run.id.slice(0, 12)}`}
            </h1>
            {run.pr_number && (
              <span className="font-mono text-sm text-slate-500">#{run.pr_number}</span>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                passed
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : failed
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : inconclusive
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              {passed
                ? "Passed"
                : failed
                ? "Failed"
                : inconclusive
                ? "Inconclusive"
                : run.status === "running"
                ? "Running"
                : run.status}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            {run.repo && <span className="font-semibold text-slate-700">{run.repo}</span>}
            {run.pr_author && <span>· {run.pr_author}</span>}
            {run.pr_opened_at && <span>· opened {relativeTime(run.pr_opened_at)}</span>}
            <span>· tested {relativeTime(run.completed_at || run.created_at)}</span>
            {run.pr_head_branch && (
              <span className="font-mono">
                · {run.pr_head_branch}
                {run.pr_base_branch ? ` → ${run.pr_base_branch}` : ""}
              </span>
            )}
            {run.sha && <span className="font-mono">· {run.sha.slice(0, 7)}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            href={`/dashboard/runs/${encodeURIComponent(run.id)}/analytics`}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </Link>
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              View in GitHub <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {isLive && (
            <button
              onClick={cancelRun}
              disabled={cancelling}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              title="Stop this run and tear down its sandbox"
            >
              {cancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Ban className="h-3.5 w-3.5" />
              )}
              {cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          )}
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {cancelError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{cancelError}</span>
        </div>
      )}

      {run.failure_kind && run.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <span className="font-bold">
              Failed at {run.failure_kind.replace(/_/g, " ")}.
            </span>
            <p className="font-mono text-[11px] leading-relaxed break-words">
              {run.error.split("\n")[0].slice(0, 400)}
            </p>
            {hasLogs && (
              <span className="text-[10px] text-rose-600">
                Full build output is in “Build &amp; engine logs” below.
              </span>
            )}
          </div>
        </div>
      )}

      {run.summary && run.pr_title && (
        <p className="text-xs text-slate-600 -mt-2">{run.summary}</p>
      )}

      {/* ============================ BODY ============================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ------------------------- LEFT: TEST CASES ------------------------- */}
        <div className="lg:col-span-5 xl:col-span-4 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
          <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900">
                {counts.failed > 0
                  ? "All Test Cases"
                  : cases.length > 0 && counts.passed === cases.length
                  ? "All tests passed"
                  : "All Test Cases"}
              </span>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                {counts.passed > 0 && (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {counts.passed}
                  </span>
                )}
                {counts.failed > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5" /> {counts.failed}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {([
                ["all", `All (${cases.length})`],
                ["failed", `Failed (${counts.failed})`],
                ["passed", `Passed (${counts.passed})`],
                ["other", `Other (${counts.skipped})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
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

          <div className="max-h-[640px] overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">
                {cases.length === 0
                  ? "This run recorded no structured test cases."
                  : "No test cases in this filter."}
              </p>
            ) : (
              filtered.map((testCase, index) => {
                const isSelected = selected?.id === testCase.id;
                const categoryStyle =
                  CATEGORY_STYLE[testCase.category] || "bg-slate-50 text-slate-600 border-slate-200";
                return (
                  <div key={testCase.id} className={isSelected ? "bg-slate-50/80" : ""}>
                    <button
                      onClick={() => setSelectedId(isSelected ? null : testCase.id)}
                      className="w-full text-left p-3 transition-colors hover:bg-slate-50/80 cursor-pointer"
                    >
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-[10px] text-slate-400 w-4 shrink-0 pt-0.5">
                          {index + 1}.
                        </span>
                        <span className="shrink-0 pt-0.5">
                          {testCase.status === "passed" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          ) : testCase.status === "failed" ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          ) : (
                            <MinusCircle className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 text-xs font-medium text-slate-800">
                          {testCase.name}
                        </span>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${categoryStyle}`}
                        >
                          {testCase.category.replace(/_/g, " ")}
                        </span>
                      </div>
                    </button>

                    {isSelected && (
                      <div className="px-3 pb-3 pl-9 space-y-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-[11px] leading-relaxed">
                          <div>
                            <span className="font-bold text-slate-900 block">Description</span>
                            <p className="text-slate-600">
                              {testCase.failure_reason ||
                                testCase.impact ||
                                (testCase.status === "passed"
                                  ? "This case executed without a recorded defect."
                                  : "No failure description was recorded for this case.")}
                            </p>
                          </div>
                          {testCase.impact && testCase.failure_reason && (
                            <div>
                              <span className="font-bold text-slate-900 block">Impact</span>
                              <p className="text-slate-600">{testCase.impact}</p>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 pt-1">
                            {testCase.severity && (
                              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                                {testCase.severity}
                              </span>
                            )}
                            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                              {testCase.origin.replace(/_/g, " ")}
                            </span>
                            {testCase.route && (
                              <span className="font-mono text-[10px] text-slate-400 truncate">
                                {testCase.route}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ------------------------- RIGHT: EVIDENCE ------------------------- */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          {/* Recording */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            {activeVideo ? (
              <CustomVideoPlayer src={activeVideo} />
            ) : (
              <div className="aspect-video w-full flex flex-col items-center justify-center gap-2 bg-slate-950 text-slate-400">
                <Video className="h-6 w-6" />
                <span className="text-xs">No recording was captured for this run.</span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-[10px] text-slate-500">
              <span className="truncate">
                {selected
                  ? `Evidence for “${selected.name}”`
                  : "Run recording"}
                {run.duration_s ? ` · ${Number(run.duration_s).toFixed(1)}s` : ""}
              </span>
              <span className="font-mono truncate">
                {run.id} · {run.scope} scope · {run.test_type}
              </span>
            </div>
          </div>

          {/* Build & engine logs — the CI/Vercel-style log view */}
          <details
            open={hasLogs && (Boolean(run.failure_kind) || failed || run.result_status === "error")}
            className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs group"
          >
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none">
              <span className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <Terminal className="h-3.5 w-3.5 text-slate-500" />
                Build &amp; engine logs
              </span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {run.failure_kind ? (
                  <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                    {run.failure_kind.replace(/_/g, " ")}
                  </span>
                ) : hasLogs ? (
                  `${logText.length.toLocaleString()} chars`
                ) : (
                  "empty"
                )}
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-50/70 border-b border-slate-100">
                <span className="text-[10px] text-slate-500">
                  Redacted build/boot output. Secret values are stripped before storage.
                </span>
                {hasLogs && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyLog}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      {copiedLog ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      {copiedLog ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={downloadLog}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Download className="h-3 w-3" /> Download .log
                    </button>
                  </div>
                )}
              </div>

              {hasLogs ? (
                <pre className="max-h-[28rem] overflow-auto bg-slate-950 px-4 py-3 text-[11px] leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
                  {logText}
                </pre>
              ) : (
                <p className="p-4 text-[11px] italic text-slate-500">
                  No build or engine log was recorded for this run.
                </p>
              )}

              {consoleErrors.length > 0 && (
                <div className="border-t border-slate-100 p-4 space-y-2">
                  <span className="text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Console errors ({consoleErrors.length})
                  </span>
                  <ul className="space-y-1.5">
                    {consoleErrors.map((err, i) => (
                      <li
                        key={i}
                        className="rounded border border-rose-100 bg-rose-50/60 px-2 py-1.5 font-mono text-[10px] text-rose-800 break-words"
                      >
                        {err}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>

          {/* Reproduction steps */}
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs group">
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none">
              <span className="text-xs font-bold text-slate-900">Reproduction Steps</span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {selected?.reproduction_steps?.length || 0} steps
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-slate-100 p-4">
              {selected && selected.reproduction_steps.length > 0 ? (
                <ol className="space-y-2">
                  {selected.reproduction_steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[11px] text-slate-700">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[11px] text-slate-500 italic">
                  No reproduction steps were recorded for this case.
                </p>
              )}
            </div>
          </details>

          {/* Stub / mock context */}
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs group">
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none">
              <span className="text-xs font-bold text-slate-900">Stub / mock context</span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {selected?.mock_context?.length || 0} notes
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-slate-100 p-4">
              {selected && selected.mock_context.length > 0 ? (
                <ul className="space-y-1.5">
                  {selected.mock_context.map((line, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-slate-700">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500 italic">
                  No stubbed network calls or mocked dependencies were required for this case.
                </p>
              )}
              {run.environment_context &&
                ((run.environment_context.variable_names?.length || 0) +
                  (run.environment_context.secret_names?.length || 0) +
                  (run.environment_context.seed_names?.length || 0) >
                  0) && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-[10px] text-slate-600 space-y-0.5">
                    <span className="font-semibold block text-slate-800">Run environment</span>
                    {run.environment_context.variable_names?.length ? (
                      <div>
                        Variables:{" "}
                        <span className="font-mono">
                          {run.environment_context.variable_names.join(", ")}
                        </span>
                      </div>
                    ) : null}
                    {run.environment_context.secret_names?.length ? (
                      <div>
                        Secrets:{" "}
                        <span className="font-mono">
                          {run.environment_context.secret_names.join(", ")}
                        </span>{" "}
                        (values never shown)
                      </div>
                    ) : null}
                    {run.environment_context.seed_names?.length ? (
                      <div>
                        Seed data:{" "}
                        <span className="font-mono">
                          {run.environment_context.seed_names.join(", ")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
            </div>
          </details>

          {/* Code analysis */}
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs group">
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none">
              <span className="text-xs font-bold text-slate-900">Code Analysis</span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {selected?.code_analysis?.length || 0} snippets
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-slate-100 p-4">
              {selected && selected.code_analysis.length > 0 ? (
                <ul className="space-y-2">
                  {selected.code_analysis.map((entry, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-[11px]"
                    >
                      <span className="flex items-center gap-1.5 font-mono font-semibold text-slate-800">
                        <FileCode2 className="h-3 w-3 text-slate-500" />
                        {entry.surface || entry.route || "surface"}
                      </span>
                      {entry.note && (
                        <p className="mt-0.5 text-slate-600 leading-relaxed">{entry.note}</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500 italic">
                  No code-analysis snippets were attached to this case.
                </p>
              )}
            </div>
          </details>

          {/* Additional assets */}
          <details className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs group">
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none">
              <span className="text-xs font-bold text-slate-900">Additional Assets</span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {assets.length} {assets.length === 1 ? "file" : "files"}
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-slate-100 p-4 space-y-2">
              {assets.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic">
                  No downloadable artifacts were produced for this case.
                </p>
              ) : (
                assets.map((asset) => (
                  <a
                    key={asset.label}
                    href={asset.url}
                    {...(asset.download
                      ? { download: "" }
                      : { target: "_blank", rel: "noopener noreferrer" })}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {asset.label === "Recording" ? (
                        <Video className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      ) : asset.label === "Trace" ? (
                        <Terminal className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-800">{asset.label}</span>
                      <span className="font-mono text-slate-400 truncate">
                        {typeof asset.value === "string"
                          ? asset.value.split("/").pop()
                          : ""}
                      </span>
                    </span>
                    {asset.download ? (
                      <Download className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    )}
                  </a>
                ))
              )}
            </div>
          </details>

          {/* Run-level failures that never became a structured case */}
          {run.console_errors.length > 0 && (
            <details className="rounded-xl border border-slate-800 bg-slate-950 p-4 group">
              <summary className="text-xs font-bold text-slate-100 cursor-pointer list-none flex items-center justify-between">
                <span>Console errors ({run.console_errors.length})</span>
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <pre className="mt-2 text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {run.console_errors.join("\n")}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
