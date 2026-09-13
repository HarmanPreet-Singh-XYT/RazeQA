"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Layers,
  Play,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type CommitOption,
  type FirstRunMode,
  type RunDispatchRecord,
  FIRST_RUN_MODE_LABELS,
  persistFirstRunRecord,
} from "@/lib/first-run";

/**
 * "How do you want to run this?" — the one place that decides what a
 * verification actually covers.
 *
 * Used by the first-run briefing and by the everyday "Trigger verification"
 * button on the project page, so choosing a full sweep, a specific commit, one
 * commit's changes, or a commit range works identically whether it is the first
 * run or the fiftieth. It owns the commit lookup too, so callers only supply the
 * repository and branch.
 */

export interface RunConfigFormProps {
  repo: string;
  defaultBranch: string;
  /** Project default, so the form does not silently override a saved choice. */
  defaultTestType?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  /** Optional third action, e.g. "Not now" in the first-run briefing. */
  secondaryAction?: { label: string; onClick: () => void };
  /** Record the dispatch as this project's first run (`settings.first_run`). */
  persistFirstRunMarker?: boolean;
  /** Preselect a mode (the previous run's, so repeating is one click). */
  initialMode?: FirstRunMode;
  onDispatched: (record: RunDispatchRecord) => void;
}

export interface ModeOption {
  id: FirstRunMode;
  title: string;
  description: string;
  scope: "changed" | "full";
  needs: "none" | "commit" | "range";
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
}

export const RUN_MODES: ModeOption[] = [
  {
    id: "full-sweep",
    title: "Full sweep",
    description: "Every page is visited and checked, whether or not this change touched it.",
    scope: "full",
    needs: "none",
    icon: Layers,
    detail: "Best for a first run or a broad regression check.",
  },
  {
    id: "commit-full",
    title: "One commit — full suite",
    description: "Run the entire suite against the app exactly as it was at one chosen commit.",
    scope: "full",
    needs: "commit",
    icon: GitCommit,
    detail: "Use when you want to know whether a specific commit was ever green.",
  },
  {
    id: "commit-changes",
    title: "Only what one commit changed",
    description: "Inspect a single commit's diff and test just the surfaces it touches.",
    scope: "changed",
    needs: "commit",
    icon: GitPullRequest,
    detail: "Fastest option: the smallest change set that can still regress.",
  },
  {
    id: "commit-range",
    title: "Changes across a range",
    description: "Test everything that changed between two commits, end to end.",
    scope: "changed",
    needs: "range",
    icon: GitBranch,
    detail: "Use to verify a feature branch or a batch of commits before merging.",
  },
];

function formatCommitDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function commitLabel(commit: CommitOption): string {
  const date = formatCommitDate(commit.date);
  const short = commit.sha.slice(0, 7);
  const message = commit.message.length > 60 ? `${commit.message.slice(0, 60)}…` : commit.message;
  return `${short} · ${message}${date ? ` · ${date}` : ""}`;
}

export function RunConfigForm({
  repo,
  defaultBranch,
  defaultTestType,
  submitLabel = "Run verification",
  cancelLabel = "Cancel",
  onCancel,
  secondaryAction,
  persistFirstRunMarker = false,
  initialMode = "full-sweep",
  onDispatched,
}: RunConfigFormProps) {
  const [mode, setMode] = useState<FirstRunMode>(initialMode);
  const [testType, setTestType] = useState<"functional" | "functional + visual">(
    defaultTestType === "functional + visual" ? "functional + visual" : "functional"
  );

  const [commits, setCommits] = useState<CommitOption[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [headSha, setHeadSha] = useState<string>("");
  const [baseSha, setBaseSha] = useState<string>("");
  // Bumped by "Retry". The loader effect depends on it, so a failed load is
  // retried deliberately rather than re-fired by an unrelated re-render.
  const [commitsAttempt, setCommitsAttempt] = useState(0);

  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const selectedMode = useMemo(() => RUN_MODES.find((m) => m.id === mode) ?? RUN_MODES[0], [mode]);

  // The dependency list is the fetch trigger; re-renders caused by the state
  // below do not re-enter it.
  useEffect(() => {
    let cancelled = false;
    async function loadCommits() {
      setCommitsLoading(true);
      setCommitsError(null);
      try {
        const params = new URLSearchParams({ repo, ref: defaultBranch });
        const res = await fetch(`/api/github/commits?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data?.error || `Could not load commits (HTTP ${res.status}).`);
        }
        const list: CommitOption[] = Array.isArray(data?.commits) ? data.commits : [];
        setCommits(list);
        if (list.length > 0) {
          setHeadSha((prev) => prev || list[0].sha);
          setBaseSha((prev) => prev || list[Math.min(1, list.length - 1)].sha);
        }
      } catch (err: any) {
        if (!cancelled) {
          setCommitsError(err?.message || "Could not load commits for this repository.");
        }
      } finally {
        if (!cancelled) setCommitsLoading(false);
      }
    }

    loadCommits();
    return () => {
      cancelled = true;
    };
  }, [repo, defaultBranch, commitsAttempt]);

  const retryCommits = () => setCommitsAttempt((n) => n + 1);

  const commitBySha = useMemo(() => {
    const map = new Map<string, CommitOption>();
    commits.forEach((c) => map.set(c.sha, c));
    return map;
  }, [commits]);

  const rangeIsValid = useMemo(() => {
    if (!headSha || !baseSha || headSha === baseSha) return false;
    const headIndex = commits.findIndex((c) => c.sha === headSha);
    const baseIndex = commits.findIndex((c) => c.sha === baseSha);
    // The list is newest-first, so the range start must be the older (higher index).
    return headIndex !== -1 && baseIndex !== -1 && baseIndex > headIndex;
  }, [commits, headSha, baseSha]);

  const singleCommitParent = useMemo(() => {
    if (mode !== "commit-changes" || !headSha) return null;
    return commitBySha.get(headSha)?.parents?.[0] ?? null;
  }, [mode, headSha, commitBySha]);

  const buildPayload = (): { body: Record<string, unknown>; problem: string | null } => {
    const base: Record<string, unknown> = {
      repo_full_name: repo,
      branch: defaultBranch,
      test_type: testType,
      trigger: persistFirstRunMarker ? "first-run" : "on-demand",
      force: true,
      // Only a sweep of the live branch head describes the branch as it is now,
      // so only that may redefine the "main" baseline. Verifying an older commit
      // or a past range must never overwrite it with stale results.
      update_baseline: mode === "full-sweep",
    };

    if (mode === "full-sweep") {
      // Prefer the commit we actually listed for this branch. When the commit
      // list is unavailable, let the API resolve the branch head rather than
      // guessing here.
      return { body: { ...base, scope: "full", ...(headSha ? { sha: headSha } : {}) }, problem: null };
    }

    if (!headSha) {
      return { body: base, problem: "Choose a commit to run against." };
    }

    if (mode === "commit-full") {
      return { body: { ...base, scope: "full", sha: headSha }, problem: null };
    }

    if (mode === "commit-changes") {
      if (!singleCommitParent) {
        return {
          body: base,
          problem:
            "That commit has no parent (it is the first commit), so there is no change set to isolate.",
        };
      }
      return {
        body: { ...base, scope: "changed", sha: headSha, base_ref: singleCommitParent },
        problem: null,
      };
    }

    if (!rangeIsValid) {
      return {
        body: base,
        problem: "Pick a start commit that is older than the end commit.",
      };
    }
    return {
      body: { ...base, scope: "changed", sha: headSha, base_ref: baseSha },
      problem: null,
    };
  };

  const handleDispatch = async () => {
    const { body, problem } = buildPayload();
    if (problem) {
      setDispatchError(problem);
      return;
    }

    setIsDispatching(true);
    setDispatchError(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.status === "failed") {
        throw new Error(
          data?.error || data?.detail || `The engine rejected the run (HTTP ${res.status}).`
        );
      }

      const record: RunDispatchRecord = {
        run_id: data?.run_id ?? null,
        mode,
        scope: selectedMode.scope,
        sha: typeof body.sha === "string" ? body.sha : null,
        base_ref: typeof body.base_ref === "string" ? body.base_ref : null,
        completed_at: new Date().toISOString(),
      };

      // A failure to persist must not pretend the run did not happen — the run
      // is already dispatched — so the local marker is written regardless and
      // the caller still closes.
      if (persistFirstRunMarker) {
        await persistFirstRunRecord(
          repo,
          record,
          FIRST_RUN_MODE_LABELS[mode as FirstRunMode] ?? mode
        );
      }

      onDispatched(record);
    } catch (err: any) {
      setDispatchError(err?.message || "Could not dispatch the verification run.");
    } finally {
      setIsDispatching(false);
    }
  };

  const requiresCommits = selectedMode.needs !== "none";
  const commitControlsReady =
    !requiresCommits ||
    (!commitsLoading &&
      !commitsError &&
      commits.length > 0 &&
      (selectedMode.needs === "commit"
        ? Boolean(headSha) && (mode !== "commit-changes" || Boolean(singleCommitParent))
        : rangeIsValid));

  return (
    <div className="space-y-5">
      {dispatchError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{dispatchError}</span>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold text-slate-900">What should this run cover?</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Pick one. Any of the others can be triggered at any time.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {RUN_MODES.map((option) => {
          const isSelected = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              disabled={isDispatching}
              onClick={() => {
                setMode(option.id);
                setDispatchError(null);
              }}
              className={`text-left rounded-xl border p-3.5 transition-all ${
                isSelected
                  ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900/10 shadow-xs"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <option.icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900">{option.title}</span>
                    {isSelected && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-1">
                    {option.description}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{option.detail}</p>
                  <span className="mt-2 inline-block rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    scope: {option.scope}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Commit / range controls */}
      {requiresCommits && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
          {commitsLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Loading commits from {defaultBranch}…</span>
            </div>
          )}

          {commitsError && !commitsLoading && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {commitsError} Choose <strong>Full sweep</strong> to run without picking a commit.
                </span>
              </div>
              <button
                type="button"
                onClick={retryCommits}
                className="shrink-0 font-semibold underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {!commitsLoading && !commitsError && commits.length > 0 && (
            <>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                  {selectedMode.needs === "range" ? "End commit (newer)" : "Commit"}
                </label>
                <select
                  value={headSha}
                  onChange={(e) => {
                    setHeadSha(e.target.value);
                    setDispatchError(null);
                  }}
                  disabled={isDispatching}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-900 cursor-pointer"
                >
                  {commits.map((commit) => (
                    <option key={commit.sha} value={commit.sha}>
                      {commitLabel(commit)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMode.needs === "range" && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                    Start commit (older)
                  </label>
                  <select
                    value={baseSha}
                    onChange={(e) => {
                      setBaseSha(e.target.value);
                      setDispatchError(null);
                    }}
                    disabled={isDispatching}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-900 cursor-pointer"
                  >
                    {commits.map((commit) => (
                      <option key={commit.sha} value={commit.sha}>
                        {commitLabel(commit)}
                      </option>
                    ))}
                  </select>
                  {!rangeIsValid && (
                    <p className="text-[10px] text-amber-700 mt-1">
                      Choose a start commit older than the end commit.
                    </p>
                  )}
                </div>
              )}

              {selectedMode.needs === "commit" && mode === "commit-changes" && (
                <p className="text-[10px] text-slate-500">
                  {singleCommitParent ? (
                    <>
                      Diff base:{" "}
                      <span className="font-mono text-slate-700">
                        {singleCommitParent.slice(0, 7)}
                      </span>{" "}
                      (the parent of the selected commit).
                    </>
                  ) : (
                    <span className="text-amber-700">
                      This commit has no parent, so its change set cannot be isolated.
                    </span>
                  )}
                </p>
              )}
            </>
          )}

          {!commitsLoading && !commitsError && commits.length === 0 && (
            <p className="text-[11px] text-slate-500">
              No commits were returned for <span className="font-mono">{defaultBranch}</span>. Choose{" "}
              <strong>Full sweep</strong> to run against the branch head.
            </p>
          )}
        </div>
      )}

      {/* Test type */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
        <div>
          <p className="text-xs font-semibold text-slate-800">Checks to run</p>
          <p className="text-[11px] text-slate-500">
            Visual inspection adds multimodal screenshot review to every visited page.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["functional", "functional + visual"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={isDispatching}
              onClick={() => setTestType(option)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                testType === option
                  ? "border-slate-900 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option === "functional" ? "Functional" : "Functional + visual"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
        <Button
          type="button"
          variant="outline"
          disabled={isDispatching}
          onClick={onCancel}
          className="text-xs px-3.5 py-2 gap-1 border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{cancelLabel}</span>
        </Button>
        <div className="flex items-center gap-2">
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={isDispatching}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              {secondaryAction.label}
            </button>
          )}
          <Button
            type="button"
            disabled={isDispatching || !commitControlsReady}
            onClick={handleDispatch}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {isDispatching ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Dispatching…</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>{submitLabel}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
