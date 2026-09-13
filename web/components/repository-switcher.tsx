"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Globe,
  GitBranch,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  AlertCircle,
} from "lucide-react";
import { useDashboard } from "./dashboard-context";

/**
 * A repository the deployment's GitHub App can reach but which has not been
 * imported into AutoQA yet. Discovery is read-only (see lib/github/discovery),
 * so these entries only become projects when the user selects them.
 */
export interface AvailableRepo {
  repo_full_name: string;
  repo_name: string;
  default_branch: string;
  private: boolean;
}

/** Settings written for a repo imported straight from the switcher. */
export const DEFAULT_IMPORTED_SETTINGS = {
  framework: "nextjs",
  package_manager: "npm",
  build_command: "npm run build",
  start_command: "npm start",
  port: 3000,
  scope: "changed",
  test_type: "functional",
  enable_on_push: true,
  enable_on_pr: true,
  auto_repair: {
    enabled: false,
    build_command: "npm run build",
    test_command: "npm test",
    max_steps: 10,
    cost_limit_usd: 1.0,
    wall_time_limit_seconds: 180,
    custom_instructions: "",
    env_vars: {},
  },
  testing: { testing_instructions: "", enable_login_flow: true },
  roles: { user: { email: "" }, admin: { email: "" } },
};

/**
 * Load every repository the GitHub App can see, regardless of import state.
 *
 * The project switcher needs the full catalogue so a user can jump straight to
 * a granted repo without detouring through the import screen. The endpoint is
 * annotated with `imported`, which is what lets the list show connected and
 * not-yet-connected repositories together.
 */
export function useAvailableRepos() {
  const [available, setAvailable] = useState<AvailableRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          res.status === 401
            ? "Session expired — sign in again to list repositories."
            : data.error || "Could not load repositories from the GitHub App."
        );
        setAvailable([]);
        return;
      }
      const data = await res.json();
      setAvailable(
        (data.repositories || []).map((r: any) => ({
          repo_full_name: r.repo_full_name,
          repo_name: r.repo_name || r.repo_full_name?.split("/")[1] || r.repo_full_name,
          default_branch: r.default_branch || "main",
          private: !!r.private,
        }))
      );
    } catch {
      setError("Could not reach the repository service.");
      setAvailable([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { available, isLoading, error, reload: load };
}

/**
 * Import a discovered repository as a project and return its full name.
 *
 * Uses the same `POST /api/projects` the explicit import screen uses, so
 * ownership, GitHub reachability, and build-command validation are all enforced
 * server-side exactly as they are there. Throws with the server's message so
 * callers can surface it without inventing an explanation.
 */
export async function importRepositoryAsProject(repo: AvailableRepo): Promise<string> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_full_name: repo.repo_full_name,
      default_branch: repo.default_branch,
      settings: { ...DEFAULT_IMPORTED_SETTINGS, name: repo.repo_name },
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not import ${repo.repo_full_name}.`);
  }
  return repo.repo_full_name;
}

/** The shared pieces of a repo-switching dropdown, used by both trigger styles. */
export interface RepoSwitcherModel {
  available: AvailableRepo[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  /** Available repos the user has not imported yet, filtered by `query`. */
  unimported: AvailableRepo[];
  /** Imported (non-external) projects, filtered by `query`. */
  projects: Array<{ repo_full_name: string; name?: string; type?: string }>;
  /** Imported external-site projects (not filtered: they are never "repos"). */
  externalProjects: Array<{ repo_full_name: string; name?: string; type?: string }>;
  query: string;
  setQuery: (value: string) => void;
  busyRepo: string | null;
  actionError: string | null;
  selectProject: (repoFullName: string) => Promise<void>;
  importAndSelect: (repo: AvailableRepo) => Promise<void>;
}

interface UseRepoSwitcherArgs {
  selectedRepo: string | null;
  projects: Array<{ repo_full_name: string; name?: string; type?: string }>;
  onSelect: (repoFullName: string, wasImported: boolean) => void | Promise<void>;
  /** Called after a successful import, before switching to it. */
  onImported?: () => void | Promise<void>;
}

/** Data + actions behind a repository switcher, independent of its trigger UI. */
export function useRepoSwitcher({
  selectedRepo,
  projects,
  onSelect,
  onImported,
}: UseRepoSwitcherArgs): RepoSwitcherModel {
  const { refreshProjects } = useDashboard();
  const { available, isLoading, error, reload } = useAvailableRepos();

  const [query, setQuery] = useState("");
  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Repos imported during this session. The dashboard's project list is owned by
  // a parent context that may not have refreshed yet, and the GitHub discovery
  // response is cached, so without this a just-imported repo would appear in
  // both "Your projects" and "Available on GitHub".
  const [importedThisSession, setImportedThisSession] = useState<Set<string>>(new Set());

  const importedNames = useMemo(() => {
    const names = new Set(projects.map((p) => p.repo_full_name.toLowerCase()));
    for (const name of importedThisSession) names.add(name.toLowerCase());
    return names;
  }, [projects, importedThisSession]);

  const externalProjects = useMemo(
    () => projects.filter((p) => p.repo_full_name.startsWith("external:")),
    [projects]
  );

  const unimported = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return available.filter(
      (r) =>
        !importedNames.has(r.repo_full_name.toLowerCase()) &&
        (!needle ||
          r.repo_name.toLowerCase().includes(needle) ||
          r.repo_full_name.toLowerCase().includes(needle))
    );
  }, [available, importedNames, query]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        !p.repo_full_name.startsWith("external:") &&
        (!needle ||
          (p.name || "").toLowerCase().includes(needle) ||
          p.repo_full_name.toLowerCase().includes(needle))
    );
  }, [projects, query]);

  const selectProject = useCallback(
    async (repoFullName: string) => {
      setActionError(null);
      await onSelect(repoFullName, true);
    },
    [onSelect]
  );

  const importAndSelect = useCallback(
    async (repo: AvailableRepo) => {
      setBusyRepo(repo.repo_full_name);
      setActionError(null);
      try {
        await importRepositoryAsProject(repo);
        setImportedThisSession((prev) => new Set(prev).add(repo.repo_full_name));
        // Refresh so the newly imported row (with any server-normalized
        // settings) replaces the optimistic entry in the dashboard context.
        await refreshProjects?.();
        await onImported?.();
        await onSelect(repo.repo_full_name, false);
      } catch (err: any) {
        setActionError(err?.message || "Import failed.");
      } finally {
        setBusyRepo(null);
      }
    },
    [onImported, onSelect, refreshProjects]
  );

  return {
    available,
    isLoading,
    error,
    reload,
    unimported,
    projects: visibleProjects,
    externalProjects,
    query,
    setQuery,
    busyRepo,
    actionError,
    selectProject,
    importAndSelect,
  };
}

interface RepoOptionsProps {
  model: RepoSwitcherModel;
  selectedRepo: string | null;
  /** Close the surrounding dropdown after a selection. */
  onDone: () => void;
  /** Hide the "available on GitHub" section (used by compact triggers). */
  hideAvailable?: boolean;
  /** Hide the search box (used where the list is short). */
  hideSearch?: boolean;
}

/**
 * The list of switchable projects and importable repositories.
 *
 * Shared by the header pill, the "Target GitHub Repo" field, and the external
 * settings tab so every entry point offers the same set of choices.
 */
export function RepoOptions({
  model,
  selectedRepo,
  onDone,
  hideAvailable = false,
  hideSearch = false,
}: RepoOptionsProps) {
  const {
    isLoading,
    error,
    reload,
    unimported,
    projects,
    externalProjects,
    query,
    setQuery,
    busyRepo,
    actionError,
    selectProject,
    importAndSelect,
  } = model;

  return (
    <div className="text-xs">
      {!hideSearch && (
        <div className="relative px-0.5 pb-1.5">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects and repositories..."
            className="w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
          />
        </div>
      )}

      {actionError && (
        <div className="mx-1 mb-1 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto">
        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Your projects
        </div>
        {projects.length === 0 && externalProjects.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-slate-400">
            {query ? "No imported projects match." : "No projects imported yet."}
          </p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((p) => {
              const isCurrent = selectedRepo === p.repo_full_name;
              return (
                <button
                  key={p.repo_full_name}
                  type="button"
                  onClick={async () => {
                    await selectProject(p.repo_full_name);
                    onDone();
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                    isCurrent
                      ? "bg-emerald-50 font-bold text-emerald-800"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="truncate">{p.name || p.repo_full_name}</span>
                  </span>
                  {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                </button>
              );
            })}
            {externalProjects.map((p) => {
              const isCurrent = selectedRepo === p.repo_full_name;
              return (
                <button
                  key={p.repo_full_name}
                  type="button"
                  onClick={async () => {
                    await selectProject(p.repo_full_name);
                    onDone();
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                    isCurrent
                      ? "bg-sky-50 font-bold text-sky-800"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                    <span className="truncate">{p.name || p.repo_full_name}</span>
                  </span>
                  {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-sky-600" />}
                </button>
              );
            })}
          </div>
        )}

        {!hideAvailable && (
          <>
            <div className="mt-1 flex items-center justify-between border-t border-slate-100 px-2 pb-1 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Available on GitHub
              </span>
              <button
                type="button"
                onClick={reload}
                disabled={isLoading}
                title="Refresh repository list"
                className="text-slate-400 transition-colors hover:text-slate-700 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {error ? (
              <p className="px-2 py-1.5 text-[11px] text-amber-700">{error}</p>
            ) : isLoading ? (
              <p className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading repositories...
              </p>
            ) : unimported.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-slate-400">
                {model.available.length === 0
                  ? "No repositories granted to the GitHub App."
                  : query
                    ? "No matching repositories."
                    : "Every accessible repository is already imported."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {unimported.map((r) => (
                  <button
                    key={r.repo_full_name}
                    type="button"
                    disabled={busyRepo === r.repo_full_name}
                    onClick={async () => {
                      await importAndSelect(r);
                      onDone();
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {busyRepo === r.repo_full_name ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
                      ) : (
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="truncate">{r.repo_name}</span>
                      {r.private && <Lock className="h-2.5 w-2.5 shrink-0 text-slate-400" />}
                    </span>
                    <span className="ml-2 shrink-0 text-[10px] font-semibold text-emerald-700">
                      {busyRepo === r.repo_full_name ? "Importing..." : "Import & switch"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-1 border-t border-slate-100 pt-1.5">
        <a
          href="/dashboard/new"
          className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Import another repository</span>
        </a>
      </div>
    </div>
  );
}

interface RepositorySwitcherProps {
  /** Currently selected project, in `owner/repo` or `external:host` form. */
  selectedRepo: string | null;
  /** Imported projects to list alongside the available repositories. */
  projects: Array<{ repo_full_name: string; name?: string; type?: string }>;
  /** Called after a successful selection or import. */
  onSelect: (repoFullName: string, wasImported: boolean) => void | Promise<void>;
  /**
   * Runs after a repository is successfully imported but before switching to
   * it, so callers can refresh their project list first.
   */
  onImported?: () => void | Promise<void>;
  /** Visual variant. External settings use the sky accent. */
  variant?: "default" | "external";
  className?: string;
  /**
   * Render the trigger. When omitted, a compact pill is used (the global
   * header). When provided, callers can make a wide field act as the selector.
   */
  renderTrigger?: (args: {
    isOpen: boolean;
    toggle: () => void;
    label: string;
    model: RepoSwitcherModel;
  }) => React.ReactNode;
  /**
   * Extra classes for the dropdown panel. Defaults to a fixed-width menu
   * suitable for a compact pill; wide triggers pass `w-full` instead.
   */
  menuClassName?: string;
}

/**
 * A repository switcher that lists the projects already imported *and* every
 * repository the GitHub App grants access to.
 *
 * Selecting an un-imported repository imports it on the spot, so the dropdown
 * is a genuine project switcher rather than a list that silently omits most of
 * the user's repositories.
 */
export function RepositorySwitcher({
  selectedRepo,
  projects,
  onSelect,
  onImported,
  variant = "default",
  className = "",
  renderTrigger,
  menuClassName = "w-80",
}: RepositorySwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const model = useRepoSwitcher({ selectedRepo, projects, onSelect, onImported });

  // Close on outside click / Escape so the menu behaves like a real popover.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const isExternalVariant = variant === "external";
  const accentText = isExternalVariant ? "text-sky-600" : "text-emerald-600";

  const label = selectedRepo
    ? selectedRepo.startsWith("external:")
      ? selectedRepo.replace("external:", "")
      : selectedRepo
    : "Select project";

  const selectedIsExternal = Boolean(selectedRepo?.startsWith("external:"));
  const toggle = () => setIsOpen((v) => !v);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {renderTrigger ? (
        renderTrigger({ isOpen, toggle, label, model })
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-mono font-bold transition-colors cursor-pointer ${
            isExternalVariant
              ? "bg-sky-50 hover:bg-sky-100 border-sky-200 text-sky-900"
              : "bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800"
          }`}
        >
          {selectedIsExternal ? (
            <Globe className={`h-3 w-3 ${accentText}`} />
          ) : (
            <GitBranch className="h-3 w-3 text-slate-500" />
          )}
          <span className="max-w-[220px] truncate">{label}</span>
          <ChevronDown
            className={`h-3 w-3 ${isExternalVariant ? "text-sky-500" : "text-slate-400"}`}
          />
        </button>
      )}

      {isOpen && (
        <div
          className={`absolute left-0 z-50 mt-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in-50 zoom-in-95 ${menuClassName}`}
        >
          <RepoOptions model={model} selectedRepo={selectedRepo} onDone={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
}
