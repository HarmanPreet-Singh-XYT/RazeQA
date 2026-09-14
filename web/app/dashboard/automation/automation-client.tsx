"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, RefreshCw, Workflow } from "lucide-react";
import { useDashboard } from "@/components/dashboard-context";

/**
 * Per-repository review automation.
 *
 * A repository is not simply on or off. Reviewing can be paused without
 * revoking access, results can be kept out of GitHub while the signal is being
 * evaluated, and drafts and bot-authored PRs are decisions of their own.
 */

type Mode = "active" | "silent" | "paused";

interface Policy {
  mode: Mode;
  reviews: boolean;
  draft_prs: boolean;
  bot_prs: boolean;
  comments: boolean;
}

const DEFAULT_POLICY: Policy = {
  mode: "active",
  reviews: true,
  draft_prs: false,
  bot_prs: true,
  comments: true,
};

const MODE_COPY: Record<Mode, { label: string; blurb: string }> = {
  active: {
    label: "Active",
    blurb: "Review every eligible pull request and post results back to GitHub.",
  },
  silent: {
    label: "Silent",
    blurb: "Review pull requests but keep the results in this dashboard only.",
  },
  paused: {
    label: "Paused",
    blurb: "Do not review automatically. Useful during a migration or while a repository is unstable.",
  },
};

function normalizePolicy(settings: any): Policy {
  const raw = settings?.automation;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_POLICY };
  const mode: Mode = raw.mode === "silent" || raw.mode === "paused" ? raw.mode : "active";
  return {
    mode,
    reviews: raw.reviews !== false,
    draft_prs: raw.draft_prs === true,
    bot_prs: raw.bot_prs !== false,
    comments: raw.comments !== false,
  };
}

export function AutomationClient() {
  const { projects, refreshProjects, activeRepo } = useDashboard();
  const gitProjects = useMemo(() => projects.filter((p) => p.type !== "external"), [projects]);

  const [repo, setRepo] = useState(activeRepo || "");
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProject = useMemo(
    () => gitProjects.find((p) => p.repo_full_name === repo),
    [gitProjects, repo]
  );

  useEffect(() => {
    if (!repo && gitProjects.length > 0) setRepo(gitProjects[0].repo_full_name);
  }, [gitProjects, repo]);

  useEffect(() => {
    if (activeProject) {
      setPolicy(normalizePolicy(activeProject.settings));
      setSaved(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, activeProject?.repo_full_name]);

  const save = async () => {
    if (!repo) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_full_name: repo, settings: { automation: policy } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not save automation settings (HTTP ${res.status}).`);
        return;
      }
      await refreshProjects();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Could not reach the RazeQA server.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = (key: keyof Omit<Policy, "mode">) => setPolicy((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      <div className="space-y-1 pb-5 border-b border-slate-200">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Workflow className="h-5 w-5 text-slate-700" />
          Automation
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
          Decide when each repository is reviewed and where the results go. These controls apply to
          webhook-triggered reviews; a comment command on a pull request still runs on demand.
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
        {repo && (
          <button
            onClick={save}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? "Saved" : isSaving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!repo ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          Import a repository first to configure automation.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900">Review mode</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(Object.keys(MODE_COPY) as Mode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPolicy((prev) => ({ ...prev, mode }))}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    policy.mode === mode
                      ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900/10"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className="text-xs font-bold text-slate-900 block">{MODE_COPY[mode].label}</span>
                  <span className="text-[11px] text-slate-500 leading-relaxed block mt-1">
                    {MODE_COPY[mode].blurb}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900">What gets reviewed</h2>
            {[
              {
                key: "reviews" as const,
                label: "Review pull requests automatically",
                blurb: "Turn off to stop automatic reviews without removing repository access.",
              },
              {
                key: "draft_prs" as const,
                label: "Include draft pull requests",
                blurb: "Off skips drafts. A comment command can still request one on demand.",
              },
              {
                key: "bot_prs" as const,
                label: "Include bot-authored pull requests",
                blurb: "Dependabot, Renovate and similar automated authors.",
              },
              {
                key: "comments" as const,
                label: "Post results back to GitHub",
                blurb: "Off keeps results in this dashboard only. Review mode Silent also disables posting.",
              },
            ].map((row) => (
              <label
                key={row.key}
                className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50/70"
              >
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">{row.label}</span>
                  <span className="text-[11px] text-slate-500">{row.blurb}</span>
                </div>
                <input
                  type="checkbox"
                  checked={policy[row.key]}
                  onChange={() => toggle(row.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                />
              </label>
            ))}
          </div>

          <p className="text-[11px] text-slate-400">
            Looking for credentials and test data?{" "}
            <Link href="/dashboard/context" className="underline hover:text-slate-700">
              Context &amp; Secrets
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
