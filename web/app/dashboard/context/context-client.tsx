"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, KeyRound, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useDashboard } from "@/components/dashboard-context";
import { SkeletonList } from "@/components/loading-state";

/**
 * Per-repository variables, secrets and seed data.
 *
 * Secrets are write-only: they are encrypted before they leave this page, the
 * API never returns the value, and after saving you can only see the name.
 */

type Kind = "variable" | "secret" | "seed";

interface ContextEntry {
  id: string;
  kind: Kind;
  name: string;
  value: string | null;
  encrypted: boolean;
  description: string | null;
  updated_at: string | null;
}

const KIND_COPY: Record<Kind, { title: string; blurb: string; placeholder: string }> = {
  variable: {
    title: "Variables",
    blurb: "Non-sensitive configuration the app or the agent needs, such as a base URL or a feature flag.",
    placeholder: "BASE_URL",
  },
  secret: {
    title: "Secrets",
    blurb: "Credentials and tokens. Encrypted at rest; the value cannot be read back once saved.",
    placeholder: "STRIPE_TEST_KEY",
  },
  seed: {
    title: "Seed data",
    blurb: "Facts the agent needs that the code cannot reveal, such as a test account or a record id.",
    placeholder: "test_account_email",
  },
};

export function ContextSecretsClient() {
  const { projects, activeRepo, isLoadingProjects } = useDashboard();
  const [repo, setRepo] = useState(activeRepo || "");
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [secretsConfigured, setSecretsConfigured] = useState(true);
  const [migrationRequired, setMigrationRequired] = useState(false);
  // Starts true: the entries are fetched in an effect below. Starting false
  // showed "Nothing configured." for every section while the request was in
  // flight, which is indistinguishable from a genuinely empty project.
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>("variable");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!repo && projects.length > 0) setRepo(projects[0].repo_full_name);
  }, [projects, repo]);

  const load = async (target: string) => {
    if (!target) {
      // Nothing to fetch yet; do not leave the view stuck in a loading state.
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/context?repo=${encodeURIComponent(target)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not load context (HTTP ${res.status}).`);
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
      setSecretsConfigured(Boolean(data?.secrets_configured));
      setMigrationRequired(Boolean(data?.migration_required));
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

  const handleSave = async () => {
    if (!repo || !name.trim() || !value) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, kind, name: name.trim(), value, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not save (HTTP ${res.status}).`);
        return;
      }
      setName("");
      setValue("");
      setDescription("");
      await load(repo);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (entry: ContextEntry) => {
    const res = await fetch(
      `/api/projects/context?repo=${encodeURIComponent(repo)}&id=${encodeURIComponent(entry.id)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    }
  };

  const grouped = (target: Kind) => entries.filter((e) => e.kind === target);

  // Until a repository is selected there is nothing to fetch. If the project
  // list is still arriving (or has arrived but the selection effect has not run
  // yet) this is still a loading window, not an empty configuration.
  const awaitingRepo = !repo && (isLoadingProjects || projects.length > 0);
  const showLoading = isLoading || awaitingRepo;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      <div className="space-y-1 pb-5 border-b border-slate-200">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-slate-700" />
          Context &amp; Secrets
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
          Without context the engine can only test publicly reachable flows. Providing variables,
          secrets and seed data lets it sign in and exercise features that depend on credentials or
          known data — using dedicated test accounts, never production.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer min-w-[240px]"
        >
          <option value="">Select a repository…</option>
          {projects
            .filter((p) => p.type !== "external")
            .map((project) => (
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
      </div>

      {migrationRequired && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            The <code className="font-mono">project_context</code> table is missing. Apply
            <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">
              supabase/migrations/20260913000000_pr_centric_model.sql
            </code>
            to store context.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!secretsConfigured && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-start gap-2">
          <Lock className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
          <span>
            Secrets are disabled because <code className="font-mono">CREDENTIAL_STORE_KEY</code> is not
            configured on the server. Variables and seed data can still be saved.
          </span>
        </div>
      )}

      {/* Add form */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap gap-1.5">
          {(["variable", "secret", "seed"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setKind(option)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                kind === option
                  ? "border-slate-900 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {KIND_COPY[option].title}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">{KIND_COPY[kind].blurb}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={KIND_COPY[kind].placeholder}
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
          />
          <input
            type={kind === "secret" ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "seed" ? "value, e.g. qa+checkout@example.com" : "value"}
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-400">
            {kind === "secret"
              ? "Encrypted before it leaves this page. Never returned by the API."
              : "Stored as plain text; do not put credentials here."}
          </p>
          <button
            onClick={handleSave}
            disabled={isSaving || !repo || !name.trim() || !value}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> {isSaving ? "Saving…" : `Add ${kind}`}
          </button>
        </div>
      </div>

      {/* Lists */}
      {showLoading ? (
        <SkeletonList rows={4} />
      ) : (
        (["variable", "secret", "seed"] as const).map((section) => (
        <div key={section} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">{KIND_COPY[section].title}</h2>
            <span className="text-[10px] font-mono text-slate-400">{grouped(section).length}</span>
          </div>
          {grouped(section).length === 0 ? (
            <p className="p-5 text-center text-xs text-slate-500">Nothing configured.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {grouped(section).map((entry) => (
                <li key={entry.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-slate-900">{entry.name}</span>
                      {entry.kind === "secret" && (
                        <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                          <Lock className="h-2.5 w-2.5" /> encrypted
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono truncate block max-w-[420px]">
                      {entry.kind === "secret" ? "••••••••••••" : entry.value}
                    </span>
                    {entry.description && (
                      <span className="text-[10px] text-slate-400 block">{entry.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(entry)}
                    className="shrink-0 rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    aria-label={`Delete ${entry.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        ))
      )}

      <p className="text-[11px] text-slate-400">
        Automating which pull requests get reviewed?{" "}
        <Link href="/dashboard/projects" className="underline hover:text-slate-700">
          Repository settings
        </Link>
        .
      </p>
    </div>
  );
}
