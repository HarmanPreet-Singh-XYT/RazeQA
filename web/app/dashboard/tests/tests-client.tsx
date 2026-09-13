"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ClipboardList, ListChecks, RefreshCw, Trash2 } from "lucide-react";
import { useDashboard } from "@/components/dashboard-context";

/**
 * The reusable regression suite.
 *
 * A test saved here is injected into every later run's plan, so a flow someone
 * chose to protect keeps being exercised. Saving is opt-in from a run's test
 * cases; nothing is added automatically.
 */

interface SavedTest {
  id: string;
  name: string;
  route: string | null;
  category: string;
  intent: string | null;
  preconditions: string[];
  enabled: boolean;
  times_run: number;
  last_verified_at: string | null;
  source_run_id: string | null;
  updated_at: string | null;
}

const CATEGORY_STYLE: Record<string, string> = {
  build: "bg-rose-100 text-rose-800 border-rose-200",
  adversarial: "bg-orange-100 text-orange-800 border-orange-200",
  accessibility: "bg-violet-100 text-violet-800 border-violet-200",
  mobile: "bg-sky-100 text-sky-800 border-sky-200",
  visual: "bg-amber-100 text-amber-800 border-amber-200",
  logic: "bg-slate-100 text-slate-700 border-slate-200",
};

export function TestsClient() {
  const { projects, activeRepo } = useDashboard();
  const gitProjects = useMemo(() => projects.filter((p) => p.type !== "external"), [projects]);

  const [repo, setRepo] = useState(activeRepo || "");
  const [tests, setTests] = useState<SavedTest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!repo && gitProjects.length > 0) setRepo(gitProjects[0].repo_full_name);
  }, [gitProjects, repo]);

  const load = async (target: string) => {
    if (!target) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tests?repo=${encodeURIComponent(target)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not load tests (HTTP ${res.status}).`);
        setTests([]);
        return;
      }
      setMigrationRequired(Boolean(data?.migration_required));
      setTests(Array.isArray(data?.tests) ? data.tests : []);
    } catch (err: any) {
      setError(err?.message || "Could not reach the AutoQA server.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const toggle = async (test: SavedTest) => {
    setBusyId(test.id);
    try {
      const res = await fetch("/api/tests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, id: test.id, enabled: !test.enabled }),
      });
      if (res.ok) {
        setTests((prev) => prev.map((t) => (t.id === test.id ? { ...t, enabled: !t.enabled } : t)));
      }
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (test: SavedTest) => {
    setBusyId(test.id);
    try {
      const res = await fetch(
        `/api/tests?repo=${encodeURIComponent(repo)}&id=${encodeURIComponent(test.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) setTests((prev) => prev.filter((t) => t.id !== test.id));
    } finally {
      setBusyId(null);
    }
  };

  const enabledCount = tests.filter((t) => t.enabled).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      <div className="space-y-1 pb-5 border-b border-slate-200">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-slate-700" />
          Tests
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
          The reusable suite for a repository. Every enabled test is injected into each run&apos;s plan,
          so a flow you chose to protect keeps being exercised. Tests are never added automatically —
          save the ones worth protecting from a pull request&apos;s test cases.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer min-w-[260px]"
        >
          <option value="">Select a repository…</option>
          {gitProjects.map((project) => (
            <option key={project.repo_full_name} value={project.repo_full_name}>
              {project.repo_full_name}
            </option>
          ))}
        </select>
        <button
          onClick={() => load(repo)}
          disabled={isLoading || !repo}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </button>
        <span className="text-[11px] text-slate-500 font-mono ml-auto">
          {tests.length} test{tests.length === 1 ? "" : "s"} · {enabledCount} enabled
        </span>
      </div>

      {migrationRequired && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            The <code className="font-mono">saved_tests</code> table is missing. Apply
            <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">
              supabase/migrations/20260913000000_pr_centric_model.sql
            </code>
            to keep a reusable suite.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {tests.length === 0 && !isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <ClipboardList className="h-6 w-6 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">No saved tests yet</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Open a pull request, let the agent explore it, then save the flows worth protecting from
            its test cases. They will run automatically from then on.
          </p>
          <Link
            href="/dashboard/pull-requests"
            className="inline-block mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Go to pull requests
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
          <ul className="divide-y divide-slate-100">
            {tests.map((test) => (
              <li key={test.id} className="p-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        CATEGORY_STYLE[test.category] || CATEGORY_STYLE.logic
                      }`}
                    >
                      {test.category}
                    </span>
                    <span className="text-xs font-semibold text-slate-900 truncate">{test.name}</span>
                    {test.route && (
                      <span className="font-mono text-[11px] text-slate-500">{test.route}</span>
                    )}
                    {!test.enabled && (
                      <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        disabled
                      </span>
                    )}
                  </div>
                  {test.intent && (
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{test.intent}</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">
                    run {test.times_run}×
                    {test.last_verified_at
                      ? ` · last verified ${new Date(test.last_verified_at).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={test.enabled}
                      disabled={busyId === test.id}
                      onChange={() => toggle(test)}
                      className="h-3.5 w-3.5 cursor-pointer"
                    />
                    enabled
                  </label>
                  <button
                    onClick={() => remove(test)}
                    disabled={busyId === test.id}
                    className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    aria-label={`Delete ${test.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
