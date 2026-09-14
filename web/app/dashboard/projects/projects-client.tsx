"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Compass,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  GitBranch,
  Globe,
  History,
  KeyRound,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  User,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard, ProjectInfo } from "@/components/dashboard-context";
import { RepositorySwitcher, RepoOptions, type RepoSwitcherModel } from "@/components/repository-switcher";
import { PageSkeleton } from "@/components/loading-state";
import { ExternalProjectSettings } from "./external-project-settings";

function GithubIcon({ className = "h-4 w-4" }: { className?: string }) {
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

type RoleCredential = {
  email: string;
  password?: string;
};

type AutoRepairSettings = {
  enabled: boolean;
  trigger_mode: "automatic" | "manual_approval";
  build_command: string;
  test_command: string;
  max_steps: number;
  cost_limit_usd: number;
  wall_time_limit_seconds?: number;
  custom_instructions: string;
  model_name?: string;
  env_vars?: Record<string, string>;
};

type TestingSettings = {
  testing_instructions: string;
  enable_login_flow?: boolean;
};

type ProjectSettings = {
  framework: string;
  package_manager: string;
  build_command: string;
  start_command: string;
  port: number;
  scope: "changed" | "full";
  test_type: "functional" | "functional + visual";
  enable_on_push: boolean;
  enable_on_pr: boolean;
  pipeline_timeout_s?: number;
  auto_repair?: AutoRepairSettings;
  testing?: TestingSettings;
  roles: {
    user: RoleCredential;
    admin: RoleCredential;
    [key: string]: RoleCredential;
  };
};

type ProjectItem = {
  id: string;
  repo_full_name: string;
  installation_id?: string;
  default_branch?: string;
  settings?: ProjectSettings;
};

type RunHistoryItem = {
  /** Engine rows serialise the primary key as `id`; the DB fallback uses `run_id`. */
  run_id?: string;
  id?: string;
  repo: string;
  branch: string;
  sha: string;
  scope: string;
  test_type: string;
  status: string;
  created_at: string;
  completed_at?: string;
  tokens_saved_estimate?: number;
  cost_saved_usd_estimate?: number;
};

//: Retired model ids that may still be stored in a project's settings. Shown as
//: their current replacement so the selector never renders an unknown value.
const DEPRECATED_MODEL_SELECTIONS: Record<string, string> = {
  "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0": "bedrock/us.anthropic.claude-sonnet-4-6",
  "bedrock/us.anthropic.claude-3-5-sonnet-20241022-v2:0": "bedrock/us.anthropic.claude-sonnet-4-6",
  "anthropic/claude-3-5-sonnet-20241022": "anthropic/claude-sonnet-4.6",
  "anthropic/claude-3-5-sonnet-latest": "anthropic/claude-sonnet-4.6",
};

function normalizeModelSelection(value: string | undefined | null): string {
  if (!value) return "anthropic/claude-sonnet-4.6";
  return DEPRECATED_MODEL_SELECTIONS[value] ?? value;
}

const SAFE_BUILD_BINARIES = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "pytest",
  "python",
  "python3",
  "cargo",
  "go",
  "make",
];

type SettingsTab = "all" | "repo-build" | "roles" | "auto-repair" | "env-vars" | "runs";

/**
 * The "Target GitHub Repo" field, rendered as a real selector.
 *
 * It deliberately looks like the read-only field it replaces, but clicking it
 * opens the same project/repository list as the header switcher — including
 * repositories that are accessible but not imported yet.
 */
function RepoFieldTrigger({
  selectedRepo,
  projects,
  onSelect,
  onImported,
}: {
  selectedRepo: string | null;
  projects: ProjectInfo[];
  onSelect: (repoFullName: string, wasImported: boolean) => void | Promise<void>;
  onImported?: () => void | Promise<void>;
}) {
  return (
    <RepositorySwitcher
      className="block w-full"
      menuClassName="w-full min-w-[22rem]"
      selectedRepo={selectedRepo}
      projects={projects}
      onSelect={onSelect}
      onImported={onImported}
      renderTrigger={({ isOpen, toggle, label, model }: {
        isOpen: boolean;
        toggle: () => void;
        label: string;
        model: RepoSwitcherModel;
      }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title="Choose a connected project or import another repository"
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900 hover:border-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors cursor-pointer"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      )}
    />
  );
}

export default function ProjectsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab") as SettingsTab | null;

  const {
    activeRepo: dashboardActiveRepo,
    setActiveRepo: setDashboardActiveRepo,
    refreshProjects: refreshDashboardProjects,
    projects: dashboardProjects,
  } = useDashboard();

  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabParam && ["repo-build", "roles", "auto-repair", "env-vars", "runs"].includes(tabParam)
      ? tabParam
      : "all"
  );

  useEffect(() => {
    if (tabParam && ["repo-build", "roles", "auto-repair", "env-vars", "runs"].includes(tabParam)) {
      setActiveTab(tabParam);
    } else if (!tabParam) {
      setActiveTab("all");
    }
  }, [tabParam]);

  const handleTabChange = (newTab: SettingsTab) => {
    setActiveTab(newTab);
    if (newTab === "all") {
      router.push("/dashboard/projects");
    } else {
      router.push(`/dashboard/projects?tab=${newTab}`);
    }
  };

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  // Initial load of the project list. Without this the page rendered its
  // "no projects in this workspace" empty state while the request was still in
  // flight, which reads as an empty workspace rather than a pending one.
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  // Ownerless (agent/webhook-created) projects hidden by strict tenant scoping.
  const [hiddenUnownedProjects, setHiddenUnownedProjects] = useState(0);
  const [selectedRepo, setSelectedRepo] = useState(dashboardActiveRepo || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync with dashboardActiveRepo
  useEffect(() => {
    if (dashboardActiveRepo) {
      setSelectedRepo(dashboardActiveRepo);
    }
  }, [dashboardActiveRepo]);

  // Modals & dropdowns
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoBranch, setNewRepoBranch] = useState("main");
  const [newRepoFramework, setNewRepoFramework] = useState("nextjs");

  // Project form settings
  const [settings, setSettings] = useState<ProjectSettings>({
    framework: "nextjs",
    package_manager: "npm",
    build_command: "npm run build",
    start_command: "npm start",
    port: 3000,
    scope: "changed",
    test_type: "functional",
    enable_on_push: true,
    enable_on_pr: true,
    pipeline_timeout_s: 900,
    auto_repair: {
      enabled: false,
      trigger_mode: "automatic",
      build_command: "npm run build",
      test_command: "npm test",
      max_steps: 10,
      cost_limit_usd: 1.0,
      wall_time_limit_seconds: 180,
      custom_instructions: "",
      model_name: "anthropic/claude-sonnet-4.6",
      env_vars: {},
    },
    testing: {
      testing_instructions: "",
      enable_login_flow: true,
    },
    roles: {
      user: { email: "" },
      admin: { email: "" },
    },
  });

  // Staged passwords to update: { [roleKey]: string } - ensures unedited credentials never get overwritten
  const [passwordsToUpdate, setPasswordsToUpdate] = useState<Record<string, string>>({});
  // Password visibility map: { [roleKey]: boolean }
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});

  // Dynamic custom roles
  const [isAddRoleModalOpen, setIsAddRoleModalOpen] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleEmail, setNewRoleEmail] = useState("");
  const [newRolePassword, setNewRolePassword] = useState("");

  // Environment variables input and secret visibility toggles
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");
  const [showNewEnvVal, setShowNewEnvVal] = useState(false);
  const [showEnvSecrets, setShowEnvSecrets] = useState<Record<string, boolean>>({});

  // Test credentials status
  const [testingRole, setTestingRole] = useState<string | null>(null);
  const [testSuccessRole, setTestSuccessRole] = useState<string | null>(null);

  // Manual Run Dispatcher Modal
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);  const [runBranch, setRunBranch] = useState("main");
  const [runPrNumber, setRunPrNumber] = useState("");
  const [runSha, setRunSha] = useState("HEAD");
  const [runScope, setRunScope] = useState<"changed" | "full">("changed");
  const [runTestType, setRunTestType] = useState<"functional" | "functional + visual">("functional");
  const [runForce, setRunForce] = useState(false);
  const [isDispatchingRun, setIsDispatchingRun] = useState(false);
  const [runDispatchResult, setRunDispatchResult] = useState<any | null>(null);

  // Destructive project deletion. Deleting removes the row from `projects`
  // together with its run history, so re-importing is the only way back —
  // hence the typed-name confirmation rather than a single click.
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletedRunCount, setDeletedRunCount] = useState<number | null>(null);

  // Commit Run History state
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  // 1. Load Projects List
  //
  // Returns the fetched rows so callers can read a just-imported project's
  // settings immediately, without waiting on React state to settle.
  const loadProjects = useCallback(
    async (repoOverride?: string): Promise<ProjectItem[]> => {
      setIsLoadingProjects(true);
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) return [];
        const data = await res.json();
        setHiddenUnownedProjects(data.hidden_unowned_projects || 0);
        const rows: ProjectItem[] = data.projects || [];
        if (rows.length === 0) return rows;

        setProjects(rows);
        const target = repoOverride ?? dashboardActiveRepo;
        if (!target) {
          setSelectedRepo(rows[0].repo_full_name);
          if (rows[0].settings) {
            setSettings((prev) => ({ ...prev, ...rows[0].settings }));
          }
        } else if (!target.startsWith("external:")) {
          const matched = rows.find((p) => p.repo_full_name === target);
          if (matched?.settings) {
            setSettings((prev) => ({ ...prev, ...matched.settings }));
          }
        }
        return rows;
      } catch (err) {
        console.error("Failed to load projects", err);
        return [];
      } finally {
        setIsLoadingProjects(false);
      }
    },
    [dashboardActiveRepo]
  );

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 2. Fetch Run History whenever selectedRepo changes
  const fetchRunHistory = async (repoName: string) => {
    if (!repoName) return;
    setIsLoadingRuns(true);
    try {
      const res = await fetch(`/api/runs?repo=${encodeURIComponent(repoName)}&limit=8`);
      if (res.ok) {
        const data = await res.json();
        const rawRuns = Array.isArray(data) ? data : data.runs || [];
        setRunHistory(rawRuns);
      }
    } catch (err) {
      console.error("Failed to load run history", err);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  useEffect(() => {
    if (selectedRepo) {
      fetchRunHistory(selectedRepo);
      const proj = projects.find((p) => p.repo_full_name === selectedRepo);
      if (proj && proj.settings) {
        setSettings((prev) => ({ ...prev, ...proj.settings }));
      }
    }
  }, [selectedRepo, projects]);

  const handleSelectRepo = (p: ProjectItem) => {
    setSelectedRepo(p.repo_full_name);
    setDashboardActiveRepo(p.repo_full_name);
    if (p.settings) {
      setSettings(p.settings);
    }
  };

  /**
   * Switch to a project chosen from a repo switcher.
   *
   * When `wasImported` is false the row was just created by the switcher, so
   * this component's `projects` state does not contain it yet — reload before
   * switching, otherwise the form would render the *previous* project's
   * settings under the new repo's name.
   */
  const handleRepoSelection = async (repo: string, wasImported: boolean) => {
    if (!wasImported) {
      await loadProjects(repo);
    }
    setSelectedRepo(repo);
    setDashboardActiveRepo(repo);
  };

  // Add new repository to projects list and persist to Supabase
  const handleConnectRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;

    const trimmed = newRepoName.trim();
    const newProj: ProjectItem = {
      id: `proj-${Date.now()}`,
      repo_full_name: trimmed,
      default_branch: newRepoBranch.trim() || "main",
      settings: {
        ...settings,
        framework: newRepoFramework,
      },
    };

    setProjects((prev) => [newProj, ...prev]);
    setSelectedRepo(trimmed);
    setDashboardActiveRepo(trimmed);
    setIsAddRepoModalOpen(false);
    setNewRepoName("");

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProj),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // Do not leave a phantom project in the list when the server refused it.
        setProjects((prev) => prev.filter((p) => p.repo_full_name !== trimmed));
        setSaveError(errorData.error || `Failed to connect repository (HTTP ${res.status}).`);
        refreshDashboardProjects();
        return;
      }

      setSaveError(null);
      refreshDashboardProjects();
    } catch (err: any) {
      setProjects((prev) => prev.filter((p) => p.repo_full_name !== trimmed));
      setSaveError(err?.message || "A network error occurred while connecting the repository.");
    }
  };

  // Safe Toolchain Validation for Build Command
  const buildCommandValidation = useMemo(() => {
    const cmd = settings.auto_repair?.build_command?.trim();
    if (!cmd) {
      return { valid: false, message: "Build verification command is empty." };
    }

    const dangerousOperators = [";", "&&", "||", "|", "`", "$", ">", "<"];
    for (const op of dangerousOperators) {
      if (cmd.includes(op)) {
        return {
          valid: false,
          message: `Command contains chained operator '${op}'. Use a single safe script call for sandbox isolation.`,
        };
      }
    }

    const binary = cmd.split(/\s+/)[0]?.replace(/^.*\//, "");
    if (!SAFE_BUILD_BINARIES.includes(binary)) {
      return {
        valid: false,
        message: `Binary '${binary}' is not in the safe build allowlist (${SAFE_BUILD_BINARIES.slice(0, 6).join(", ")}...).`,
      };
    }

    return { valid: true, message: `Toolchain binary '${binary}' verified safe for sandbox execution.` };
  }, [settings.auto_repair?.build_command]);

  // Handle Save Project Settings
  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const rolesToSave: Record<string, RoleCredential> = {};
      for (const [rKey, cred] of Object.entries(settings.roles || {})) {
        const stagedPassword = passwordsToUpdate[rKey];
        if (stagedPassword !== undefined && stagedPassword.trim() && stagedPassword !== "••••••••••••") {
          rolesToSave[rKey] = {
            ...cred,
            password: stagedPassword.trim(),
          };
        } else {
          const { password: _p, ...rest } = cred;
          rolesToSave[rKey] = rest;
        }
      }

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: selectedRepo,
          settings: {
            ...settings,
            roles: rolesToSave,
          },
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setPasswordsToUpdate({});
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        const errorData = await res.json().catch(() => ({}));
        setSaveError(errorData.error || `Failed to save changes (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      console.error("Save error", err);
      setSaveError(err?.message || "A network error occurred while saving project settings.");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete the selected project (and its stored run history) from the database.
  const handleDeleteProject = async () => {
    if (!selectedRepo) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_full_name: selectedRepo }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDeleteError(data.error || `Could not delete this project (HTTP ${res.status}).`);
        return;
      }

      setDeletedRunCount(typeof data.deleted_runs === "number" ? data.deleted_runs : 0);

      const deletedRepo = selectedRepo;
      const remaining = projects.filter((p) => p.repo_full_name !== deletedRepo);

      // Re-resolve the project list from the server, then move the selection to
      // whatever remains. Keeping the deleted repo selected would leave the
      // settings form bound to a row that no longer exists.
      await refreshDashboardProjects?.();
      setDeleteConfirmName("");
      setIsDeleteModalOpen(false);

      // Nothing left to configure: leave the settings screen, which would
      // otherwise render an empty form under a "Select project" placeholder.
      // The confirmation rides along in the query string so it is not lost with
      // this component's state.
      if (remaining.length === 0) {
        // Clear the stored selection so the dashboard does not restore a repo
        // that no longer exists.
        try {
          localStorage.removeItem("autoqa_active_repo");
        } catch {}
        setDashboardActiveRepo(null);
        router.replace(
          `/dashboard?deleted=${encodeURIComponent(deletedRepo)}&deleted_runs=${
            typeof data.deleted_runs === "number" ? data.deleted_runs : 0
          }`
        );
        return;
      }

      const next = remaining[0].repo_full_name;
      setProjects(remaining);
      setSelectedRepo(next);
      setDashboardActiveRepo(next);
    } catch (err: any) {
      setDeleteError(err?.message || "A network error occurred while deleting the project.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Dispatch Manual Verification Run
  const handleDispatchRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDispatchingRun(true);
    setRunDispatchResult(null);

    try {
      const payload: any = {
        repo: selectedRepo,
        branch: runBranch.trim() || "main",
        sha: runSha.trim() || "HEAD",
        scope: runScope,
        test_type: runTestType,
        force: runForce,
      };
      if (runPrNumber.trim()) {
        payload.pr_number = parseInt(runPrNumber.replace(/\D/g, ""), 10);
      }

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setRunDispatchResult(data);
      fetchRunHistory(selectedRepo);
    } catch (err: any) {
      setRunDispatchResult({
        status: "failed",
        error: err?.message || "Failed to trigger run.",
      });
    } finally {
      setIsDispatchingRun(false);
    }
  };

  // Copy SHA helper
  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  // Add Custom Role
  const handleAddCustomRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleKey.trim() || !newRoleEmail.trim()) return;

    const key = newRoleKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    setSettings((prev) => ({
      ...prev,
      roles: {
        ...prev.roles,
        [key]: {
          email: newRoleEmail.trim(),
        },
      },
    }));

    if (newRolePassword.trim()) {
      setPasswordsToUpdate((prev) => ({
        ...prev,
        [key]: newRolePassword.trim(),
      }));
    }

    setNewRoleKey("");
    setNewRoleEmail("");
    setNewRolePassword("");
    setIsAddRoleModalOpen(false);
  };

  // Remove Custom Role
  const handleRemoveRole = (roleKey: string) => {
    if (roleKey === "user" || roleKey === "admin") return;
    const nextRoles = { ...settings.roles };
    delete nextRoles[roleKey];
    setSettings((prev) => ({ ...prev, roles: nextRoles }));
  };

  // Add Sandbox Env Var
  const handleAddEnvVar = () => {
    if (!newEnvKey.trim()) return;
    const cleanKey = newEnvKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    setSettings((prev) => ({
      ...prev,
      auto_repair: {
        ...(prev.auto_repair || {
          enabled: false,
          trigger_mode: "automatic",
          build_command: "npm run build",
          test_command: "npm test",
          max_steps: 10,
          cost_limit_usd: 1.0,
          wall_time_limit_seconds: 180,
          custom_instructions: "",
        }),
        env_vars: {
          ...(prev.auto_repair?.env_vars || {}),
          [cleanKey]: newEnvVal.trim(),
        },
      },
    }));
    setNewEnvKey("");
    setNewEnvVal("");
  };

  // Remove Sandbox Env Var
  const handleRemoveEnvVar = (key: string) => {
    const nextVars = { ...(settings.auto_repair?.env_vars || {}) };
    delete nextVars[key];
    setSettings((prev) => ({
      ...prev,
      auto_repair: {
        ...(prev.auto_repair!),
        env_vars: nextVars,
      },
    }));
  };

  // Simulate test credentials
  const handleTestRole = (roleKey: string) => {
    setTestingRole(roleKey);
    setTimeout(() => {
      setTestingRole(null);
      setTestSuccessRole(roleKey);
      setTimeout(() => setTestSuccessRole(null), 3000);
    }, 1000);
  };

  // Active repo metadata
  const currentProject = projects.find((p) => p.repo_full_name === selectedRepo) || projects[0];
  const installationId = currentProject?.installation_id || null;
  const defaultBranch = currentProject?.default_branch || "main";

  // Deduplicated (cached) run count. This previously also computed "token savings"
  // as `totalCachedRuns * 15000` tokens and `totalCachedRuns * 0.45` dollars —
  // both invented per-run constants, not measurements. SHA deduplication does skip
  // real work, but the pipeline never records how much, so the count of
  // deduplicated runs is the only honest number available.
  const totalCachedRuns = runHistory.filter((r) => r.status === "cached").length;

  // Visibility filters based on active tab
  const showRepoBuild = activeTab === "all" || activeTab === "repo-build";
  const showRoles = activeTab === "all" || activeTab === "roles";
  const showAutoRepair = activeTab === "all" || activeTab === "auto-repair";
  const showEnvVars = activeTab === "all" || activeTab === "env-vars";
  const showRunsCache = activeTab === "all" || activeTab === "runs";
  // Check if currently selected project is an External Website
  const isExternal = Boolean(selectedRepo?.startsWith("external:"));

  if (isExternal) {
    return (
      <ExternalProjectSettings
        selectedRepo={selectedRepo}
        allProjects={dashboardProjects}
        onSelectProject={(repo) => {
          setSelectedRepo(repo);
          setDashboardActiveRepo(repo);
        }}
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab as any)}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 text-slate-900 animate-in fade-in-50 duration-200">
      {/* Still fetching the first page of projects: show structure rather than
          the "no projects" empty state below. */}
      {isLoadingProjects && projects.length === 0 && (
        <PageSkeleton label="Loading repository settings…" />
      )}

      {/* Nothing to configure. This happens after deleting the last project in
          another tab; settings for a project that does not exist are not a
          useful screen. Gated on the load finishing so a pending fetch is never
          mistaken for an empty workspace. */}
      {!selectedRepo && projects.length === 0 && !isLoadingProjects && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-3">
          <FolderGit2 className="h-8 w-8 text-slate-400 mx-auto" />
          <div>
            <p className="text-sm font-semibold text-slate-800">No project selected</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              There are no projects in this workspace. Import a repository to configure
              its test credentials and trigger policies.
            </p>
          </div>
          <div className="pt-1 flex items-center justify-center gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              <span>Back to all projects</span>
            </Link>
            <Link
              href="/dashboard/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-950 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shadow-2xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Import Repository</span>
            </Link>
          </div>
        </div>
      )}

      {hiddenUnownedProjects > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 leading-relaxed">
          <span className="font-bold">
            {hiddenUnownedProjects} project{hiddenUnownedProjects === 1 ? "" : "s"} hidden.
          </span>{" "}
          This deployment only shows repositories you own. Claim the legacy rows in
          Supabase (
          <code className="font-mono">
            update projects set user_id = &apos;&lt;your-user-id&gt;&apos; where user_id is null;
          </code>
          ) or set <code className="font-mono">SHOW_UNOWNED_PROJECTS=true</code>. See{" "}
          <code className="font-mono">supabase/README.md</code>.
        </div>
      )}

      {/* Everything below binds to a selected project. With none selected (and
          none imported) the empty state above is the whole screen. */}
      {(selectedRepo || projects.length > 0) && (
        <>
      {/* Top Banner & Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-emerald-600" />
              Repository Settings &amp; Zero-Config Onboarding
            </h1>

            {/* Switch Repository Pill — lists imported projects and every repo
                the GitHub App can reach, importing on selection. */}
            <RepositorySwitcher
              selectedRepo={selectedRepo}
              projects={dashboardProjects}
              onSelect={(repo) => {
                setSelectedRepo(repo);
                setDashboardActiveRepo(repo);
              }}
            />
          </div>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Manage multi-role test credentials, manual verification dispatcher, smart token caching, and automated trigger policies.
          </p>
        </div>

        {/* Action Buttons. `flex-wrap` so the destructive action is never
            pushed off-screen on a laptop-width viewport. */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            onClick={() => setIsRunModalOpen(true)}
            variant="outline"
            className="border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold text-xs px-3 py-1.5 h-8 gap-1.5 shadow-2xs cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 text-emerald-600 fill-emerald-600" />
            <span>Trigger Test Run</span>
          </Button>

          <Button
            onClick={() => setIsDeleteModalOpen(true)}
            variant="outline"
            disabled={!selectedRepo || selectedRepo.startsWith("external:")}
            title={
              selectedRepo?.startsWith("external:")
                ? "External sites are managed from the external website settings."
                : "Delete this project"
            }
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-semibold text-xs px-3 py-1.5 h-8 gap-1.5 shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Project</span>
          </Button>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-3.5 py-1.5 h-8 gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer"
          >
            {saveSuccess ? (
              <>
                <Check className="h-3.5 w-3.5 text-white" />
                <span>Saved!</span>
              </>
            ) : isSaving ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                <span>Save Changes</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Save Error Alert Banner */}
      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 flex items-center justify-between shadow-xs animate-in fade-in-50">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <div>
              <span className="font-bold">Save Failed:</span> {saveError}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-red-600 hover:text-red-900 font-semibold text-xs ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Deletion confirmation: the row is gone from the database, so state the
          outcome and how much history went with it. */}
      {deletedRunCount !== null && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 flex items-center justify-between shadow-xs animate-in fade-in-50">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              <span className="font-bold">Project deleted.</span>{" "}
              {deletedRunCount > 0
                ? `${deletedRunCount} stored run${deletedRunCount === 1 ? "" : "s"} were removed with it.`
                : "No run history was stored for it."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDeletedRunCount(null)}
            className="text-slate-600 hover:text-slate-900 font-semibold text-xs ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Settings Tab Navigation Strip */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-0 text-xs select-none no-scrollbar">
        <button
          type="button"
          onClick={() => handleTabChange("all")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "all"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>All Configurations</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("repo-build")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "repo-build"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <GithubIcon className="h-3.5 w-3.5" />
          <span>Repository &amp; Build</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("roles")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "roles"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Shield className="h-3.5 w-3.5 text-sky-600" />
          <span>Test Personas</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("auto-repair")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "auto-repair"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
          <span>AI Auto-Repair</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("env-vars")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "env-vars"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Sliders className="h-3.5 w-3.5 text-slate-700" />
          <span>Sandbox Secrets</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("runs")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "runs"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Database className="h-3.5 w-3.5 text-indigo-600" />
          <span>Execution &amp; Cache</span>
        </button>
      </div>

      {/* Grid of Configuration Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Repository & Framework Detection & Stats */}
        <div className={`space-y-6 ${activeTab === "all" ? "lg:col-span-1" : "lg:col-span-3"}`}>
          {/* 1. Connected Repository Card */}
          {showRepoBuild && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <GithubIcon className="h-3.5 w-3.5 text-slate-700" />
                  Connected Repository
                </span>
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  Verified
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Target GitHub Repo
                </label>
                {/* This field used to be a free-text input: the repo name could
                    be typed but not chosen, and typing it changed nothing on the
                    server. It is now the switcher's trigger, so there is exactly
                    one place — and one set of choices — for picking a repo. */}
                <RepoFieldTrigger
                  selectedRepo={selectedRepo}
                  projects={dashboardProjects}
                  onSelect={handleRepoSelection}
                  // A freshly imported repo has no settings in this component's
                  // state yet; reload the list before switching so the form
                  // shows the project's real saved configuration.
                  onImported={async () => {
                    await loadProjects();
                  }}
                />
              </div>

              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
                <p className="flex items-center justify-between">
                  <span>Installation ID:</span>
                  <span className="font-mono text-slate-800 font-medium">{installationId || "None"}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span>Default Base Branch:</span>
                  <span className="font-mono text-slate-800 font-medium">{defaultBranch}</span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsAddRepoModalOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add / Connect Another Repo</span>
              </button>
            </div>
          )}

          {/* 2. Framework & Build Detection Card */}
          {showRepoBuild && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-emerald-600" />
                  Auto Build Detection
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  Zero-Config
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-slate-500 block mb-0.5">Detected Web Framework</span>
                  <span className="font-semibold text-slate-900 capitalize flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    {settings.framework} (App Router)
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block mb-0.5">Package Manager</span>
                  <span className="font-mono text-slate-800 font-medium bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                    {settings.package_manager}
                  </span>
                </div>

                <div>
                  <label className="text-slate-700 font-semibold block mb-1">Build Command</label>
                  <input
                    type="text"
                    value={settings.build_command}
                    onChange={(e) => setSettings({ ...settings, build_command: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-slate-700 font-semibold block mb-1">Start Command</label>
                  <input
                    type="text"
                    value={settings.start_command}
                    onChange={(e) => setSettings({ ...settings, start_command: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-slate-700 font-semibold block mb-1">Target Preview Port</label>
                  <input
                    type="number"
                    value={settings.port}
                    onChange={(e) => setSettings({ ...settings, port: parseInt(e.target.value) || 3000 })}
                    className="w-24 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-800"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3. Smart Caching & Token Reduction Stats Card */}
          {showRunsCache && (
            <div className="rounded-xl border border-indigo-200 bg-linear-to-br from-indigo-50/50 via-white to-sky-50/30 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-indigo-600" />
                  Deterministic Test Caching
                </span>
                <span className="rounded-full bg-indigo-100 text-indigo-800 px-2 py-0.5 text-[10px] font-bold">
                  Cost Optimizer
                </span>
              </div>

              <p className="text-xs text-slate-600">
                AutoQA automatically fingerprints commit SHAs and diff boundaries. When a commit is already verified green, cached forensics are returned instantly with zero LLM token consumption.
              </p>

              <div className="grid grid-cols-1 gap-2 pt-1 border-t border-indigo-100/80">
                <div className="rounded-lg bg-white p-2.5 border border-indigo-100 shadow-2xs">
                  <span className="text-[10px] text-slate-500 block">Verified Runs Served From Cache</span>
                  <span className="text-base font-bold text-slate-900 font-mono flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                    {totalCachedRuns}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (2 cols): Multi-Role Credentials, Triggers, & Run History */}
        <div className={`space-y-6 ${activeTab === "all" ? "lg:col-span-2" : "lg:col-span-3"}`}>
          {/* 4. Multi-Role Credential Management with Password Toggles & Custom Roles */}
          {showRoles && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-emerald-600" />
                    Multi-Role Test Credentials (Fernet-Encrypted)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Credentials are encrypted at rest and injected into preview sandboxes only at boot time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddRoleModalOpen(true)}
                  className="rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Role</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(settings.roles || {}).map(([roleKey, cred]) => {
                  const isUser = roleKey === "user";
                  const isAdmin = roleKey === "admin";
                  const isCustom = !isUser && !isAdmin;

                  return (
                    <div
                      key={roleKey}
                      className={`rounded-lg border p-4 space-y-3 transition-all ${
                        isAdmin
                          ? "border-amber-200/80 bg-amber-50/30"
                          : isCustom
                          ? "border-sky-200 bg-sky-50/30"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          {isAdmin ? (
                            <Shield className="h-3.5 w-3.5 text-amber-600" />
                          ) : isCustom ? (
                            <Users className="h-3.5 w-3.5 text-sky-600" />
                          ) : (
                            <User className="h-3.5 w-3.5 text-slate-600" />
                          )}
                          Role: <span className="capitalize">{roleKey}</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-semibold rounded px-1.5 py-0.2 ${
                              isAdmin
                                ? "text-amber-800 bg-amber-100"
                                : isCustom
                                ? "text-sky-800 bg-sky-100"
                                : "text-emerald-700 bg-emerald-100"
                            }`}
                          >
                            {isAdmin ? "Elevated" : isCustom ? "Custom" : "Primary"}
                          </span>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRole(roleKey)}
                              className="text-slate-400 hover:text-red-600 p-0.5 cursor-pointer"
                              title="Delete Role"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Email / Login</label>
                        <input
                          type="email"
                          value={cred.email || ""}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              roles: {
                                ...settings.roles,
                                [roleKey]: { ...cred, email: e.target.value },
                              },
                            })
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-mono"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Password</label>
                        <div className="relative">
                          <input
                            type={showPassword[roleKey] ? "text" : "password"}
                            value={passwordsToUpdate[roleKey] ?? ""}
                            placeholder="•••••••••••• (Leave blank to keep existing)"
                            onChange={(e) =>
                              setPasswordsToUpdate((prev) => ({
                                ...prev,
                                [roleKey]: e.target.value,
                              }))
                            }
                            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 pr-8 text-xs text-slate-900 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setShowPassword((prev) => ({ ...prev, [roleKey]: !prev[roleKey] }))
                            }
                            className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            {showPassword[roleKey] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="pt-1 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleTestRole(roleKey)}
                          disabled={testingRole === roleKey}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {testingRole === roleKey ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              <span>Verifying...</span>
                            </>
                          ) : testSuccessRole === roleKey ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              <span className="text-emerald-600">Sandbox Ready!</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="h-3 w-3 text-slate-500" />
                              <span>Verify Auth Flow</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. Commit Run History & Status Sync */}
          {showRunsCache && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                    <History className="h-4 w-4 text-emerald-600" />
                    Commit Verification History &amp; Sync
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Live log of all verified commits for <span className="font-mono font-bold text-slate-800">{selectedRepo}</span> to track test state and prevent redundant executions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchRunHistory(selectedRepo)}
                  disabled={isLoadingRuns}
                  className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingRuns ? "animate-spin text-emerald-600" : ""}`} />
                  <span>Sync</span>
                </button>
              </div>

              {runHistory.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500">
                  {isLoadingRuns ? "Loading commit history..." : "No verification runs recorded yet for this repository."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold text-[11px]">
                        <th className="py-2">Commit SHA</th>
                        <th className="py-2">Branch</th>
                        <th className="py-2">Scope</th>
                        <th className="py-2">Verification State</th>
                        <th className="py-2">Executed</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runHistory.map((run) => {
                        const shortSha = run.sha?.length > 7 ? run.sha.slice(0, 7) : (run.sha || "HEAD");
                        const runKey = run.run_id || run.id;
                        // Forensics belongs to this run, not to the fleet-wide
                        // list; fall back to this project's runs when the row
                        // carries no id to deep-link with.
                        const forensicsHref = runKey
                          ? `/dashboard/runs/${encodeURIComponent(runKey)}/analytics`
                          : `/dashboard/runs?repo=${encodeURIComponent(selectedRepo)}`;
                        return (
                          <tr key={runKey || run.sha} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 font-mono text-slate-800 font-bold flex items-center gap-1.5">
                              <span>{shortSha}</span>
                              <button
                                type="button"
                                onClick={() => handleCopySha(run.sha)}
                                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                                title="Copy SHA"
                              >
                                {copiedSha === run.sha ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </td>
                            <td className="py-2.5 text-slate-600 font-medium">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                                {run.branch || "main"}
                              </span>
                            </td>
                            <td className="py-2.5 text-slate-600">
                              <span className="capitalize">{run.scope || "changed"}</span>
                            </td>
                            <td className="py-2.5">
                              {run.status === "completed" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Verified Green
                                </span>
                              ) : run.status === "cached" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                  <Sparkles className="h-3 w-3 text-blue-600" />
                                  Cached (Zero Token Burn)
                                </span>
                              ) : run.status === "running" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                  Running
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                  <AlertCircle className="h-3 w-3" />
                                  Regression
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 text-slate-500 text-[11px]">
                              {new Date(run.created_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="py-2.5 text-right">
                              <Link
                                href={forensicsHref}
                                className="font-semibold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"
                              >
                                <span>Forensics</span>
                                <ArrowRight className="h-3 w-3" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 6. Trigger Policies & Test Defaults */}
          {showRepoBuild && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-emerald-600" />
                  Automated Verification Triggers &amp; Defaults
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure when the autonomous testing engine runs and what depth of checks it executes.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* On-Push Webhook Toggle */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-500" />
                      On-Push Verification
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.enable_on_push}
                      onChange={(e) => setSettings({ ...settings, enable_on_push: e.target.checked })}
                      className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Runs a fast, lightweight check on diff-adjacent surfaces on every push commit.
                  </p>
                </div>

                {/* On-PR Webhook Toggle */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-emerald-600" />
                      Pull Request Check Runs
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.enable_on_pr}
                      onChange={(e) => setSettings({ ...settings, enable_on_pr: e.target.checked })}
                      className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Runs complete verification with baseline comparison against main on PR open/update.
                  </p>
                </div>

                {/* Default Scope Selection */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <label className="text-xs font-bold text-slate-900 block">Default Test Scope</label>
                  <select
                    value={settings.scope}
                    onChange={(e) => setSettings({ ...settings, scope: e.target.value as "changed" | "full" })}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-medium"
                  >
                    <option value="changed">Changed (Diff-Adjacent Journeys)</option>
                    <option value="full">Full (Entire Platform Regression Sweep)</option>
                  </select>
                </div>

                {/* Default Test Type Selection */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <label className="text-xs font-bold text-slate-900 block">Default Test Type</label>
                  <select
                    value={settings.test_type}
                    onChange={(e) =>
                      setSettings({ ...settings, test_type: e.target.value as "functional" | "functional + visual" })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-medium"
                  >
                    <option value="functional">Functional Only</option>
                    <option value="functional + visual">Functional + Visual Defect Spotting</option>
                  </select>
                </div>

                {/* Job Timeout */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-slate-500" />
                      Job Timeout
                    </label>
                    <span className="font-mono text-xs font-bold text-slate-700">
                      {Math.round((settings.pipeline_timeout_s ?? 900) / 60)} min
                    </span>
                  </div>
                  <input
                    type="range"
                    min={300}
                    max={3600}
                    step={60}
                    value={settings.pipeline_timeout_s ?? 900}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const clamped = isNaN(val) ? 900 : Math.min(3600, Math.max(300, val));
                      setSettings({ ...settings, pipeline_timeout_s: clamped });
                    }}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-600">
                    Hard ceiling for a full run (build, sandbox boot, journeys, baseline). Runs still exceeding
                    this are aborted and marked failed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 7. Autonomous Agentic Repair (mini-swe-agent & Bedrock/Claude/Gemini) */}
          {showAutoRepair && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-indigo-600" />
                    Autonomous Agentic Repair (mini-swe-agent Engine)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Empowers an autonomous coding agent to diagnose regressions, edit files, and iterate until the build compiles cleanly.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Auto-Repair Active</span>
                  <input
                    type="checkbox"
                    checked={settings.auto_repair?.enabled ?? false}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_repair: {
                          ...(settings.auto_repair || {
                            enabled: false,
                            trigger_mode: "automatic",
                            build_command: "npm run build",
                            test_command: "npm test",
                            max_steps: 10,
                            cost_limit_usd: 1.0,
                            wall_time_limit_seconds: 180,
                            custom_instructions: "",
                            model_name: "anthropic/claude-sonnet-4.6",
                            env_vars: {},
                          }),
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </div>
              </div>

              {settings.auto_repair?.enabled && (
                <div className="space-y-4">
                  {/* AI Model Selection */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-2">
                    <label className="text-xs font-bold text-slate-900 block">Preferred AI Repair Model</label>
                    <select
                      value={normalizeModelSelection(settings.auto_repair?.model_name)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          auto_repair: {
                            ...(settings.auto_repair!),
                            model_name: e.target.value,
                          },
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 font-medium"
                    >
                      <option value="anthropic/claude-sonnet-4.6">Claude Sonnet 4.6 (Recommended — Best Code Reasoning)</option>
                      <option value="gemini/gemini-3.8-flash">Google Gemini 3.8 Flash (High Speed, Cost Efficient)</option>
                      <option value="bedrock/us.anthropic.claude-sonnet-4-6">AWS Bedrock: Claude Sonnet 4.6</option>
                    </select>
                    <p className="text-[10px] text-slate-500">
                      Used by mini-swe-agent to formulate bash operations, code edits, and compiler error resolution.
                    </p>
                  </div>

                  {/* Trigger Mode Segmented Selection */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-900 block">Repair Execution Mode</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        onClick={() =>
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              trigger_mode: "automatic",
                            },
                          })
                        }
                        className={`cursor-pointer rounded-lg border p-3 transition-all ${
                          settings.auto_repair?.trigger_mode === "automatic"
                            ? "border-indigo-500 bg-indigo-50/40 shadow-xs"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                            Automatic Commit on Green Build
                          </span>
                          {settings.auto_repair?.trigger_mode === "automatic" && (
                            <Check className="h-4 w-4 text-indigo-600" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Automatically commits patches to PR branch when build and verification pass with 0 errors.
                        </p>
                      </div>

                      <div
                        onClick={() =>
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              trigger_mode: "manual_approval",
                            },
                          })
                        }
                        className={`cursor-pointer rounded-lg border p-3 transition-all ${
                          settings.auto_repair?.trigger_mode === "manual_approval"
                            ? "border-indigo-500 bg-indigo-50/40 shadow-xs"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5 text-slate-600" />
                            Manual Review &amp; Approval
                          </span>
                          {settings.auto_repair?.trigger_mode === "manual_approval" && (
                            <Check className="h-4 w-4 text-indigo-600" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Generates patch proposals and execution trajectory for 1-click review in the dashboard or via @pr-agent apply.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Verification Command Inputs with Live Safe Validation */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-900">
                          Build Verification Command
                        </label>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            buildCommandValidation.valid
                              ? "text-emerald-700 bg-emerald-50 border border-emerald-200"
                              : "text-red-700 bg-red-50 border border-red-200"
                          }`}
                        >
                          {buildCommandValidation.valid ? "Safe Binary" : "Invalid Syntax"}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={settings.auto_repair?.build_command || "npm run build"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              build_command: e.target.value,
                            },
                          })
                        }
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800"
                        placeholder="npm run build"
                      />
                      <p
                        className={`text-[10px] mt-1 ${
                          buildCommandValidation.valid ? "text-slate-500" : "text-red-600 font-medium"
                        }`}
                      >
                        {buildCommandValidation.message}
                      </p>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-900 block mb-1">
                        Test Suite Command
                      </label>
                      <input
                        type="text"
                        value={settings.auto_repair?.test_command || "npm test"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              test_command: e.target.value,
                            },
                          })
                        }
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800"
                        placeholder="npm test"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Optional unit test command to execute during repair loops.
                      </p>
                    </div>
                  </div>

                  {/* Guardrail & Limits (Steps, Cost, Wall-time) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-900">
                          Max Steps
                        </label>
                        <span className="font-mono text-xs font-bold text-indigo-600">
                          {settings.auto_repair?.max_steps || 10} steps
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={30}
                        step={1}
                        value={settings.auto_repair?.max_steps || 10}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const clamped = isNaN(val) ? 10 : Math.min(30, Math.max(1, val));
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              max_steps: clamped,
                            },
                          });
                        }}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Circuit breaker: Halts if unresolved within limit.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-900">
                          Cost Budget ($ USD)
                        </label>
                        <span className="font-mono text-xs font-bold text-emerald-600">
                          ${(settings.auto_repair?.cost_limit_usd || 1.0).toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="number"
                        min={0.05}
                        max={10.0}
                        step={0.25}
                        value={settings.auto_repair?.cost_limit_usd || 1.0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const clamped = isNaN(val) ? 1.0 : Math.min(10.0, Math.max(0.05, val));
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              cost_limit_usd: clamped,
                            },
                          });
                        }}
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono text-slate-800"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Hard stop when token spend reaches threshold.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-900">
                          Wall-Time Timeout
                        </label>
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {settings.auto_repair?.wall_time_limit_seconds || 180}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={30}
                        max={600}
                        step={30}
                        value={settings.auto_repair?.wall_time_limit_seconds || 180}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const clamped = isNaN(val) ? 180 : Math.min(600, Math.max(30, val));
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              wall_time_limit_seconds: clamped,
                            },
                          });
                        }}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Overall session execution ceiling.
                      </p>
                    </div>
                  </div>

                  {/* Custom Developer Instructions */}
                  <div>
                    <label className="text-xs font-bold text-slate-900 block mb-1">
                      Custom Repair Instructions &amp; Guardrail Directives
                    </label>
                    <textarea
                      rows={2}
                      value={settings.auto_repair?.custom_instructions || ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          auto_repair: {
                            ...(settings.auto_repair!),
                            custom_instructions: e.target.value,
                          },
                        })
                      }
                      placeholder="e.g. Strictly maintain TypeScript types. Do not modify Tailwind configuration files or global layout wrappers."
                      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Instructions will be injected directly into the agent's task context inside safe &lt;developer_guidelines&gt; tags.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 7b. Autonomous Exploration & Scope Planning Instructions Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Compass className="h-4 w-4 text-indigo-600" />
                  Autonomous Exploration &amp; Testing Instructions
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Direct the mini-swe-agent scope planner on what matters most to test across your application surfaces.
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-900 block mb-1">
                Testing Instructions
              </label>
              <textarea
                rows={3}
                value={settings.testing?.testing_instructions || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    testing: {
                      ...(settings.testing || { testing_instructions: "" }),
                      testing_instructions: e.target.value,
                    },
                  })
                }
                placeholder="Tell the agent what matters most to test (e.g. 'focus on checkout and account settings', 'skip the marketing pages')."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Tell the agent what matters most to test (e.g. 'focus on checkout and account settings', 'skip the marketing pages').
              </p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <div>
                <span className="text-xs font-semibold text-slate-800 block">Include Authentication / Login Journey</span>
                <p className="text-[10px] text-slate-500">
                  When enabled and test credentials exist, logs in before exploring pages. Uncheck if the app has no authentication or you only want unauthenticated testing.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.testing?.enable_login_flow ?? true}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    testing: {
                      ...(settings.testing || { testing_instructions: "" }),
                      enable_login_flow: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
            </div>
          </div>

          {/* 8. Custom Sandbox Environment Variables Card */}
          {showEnvVars && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-slate-700" />
                    Custom Sandbox Environment Variables &amp; Secrets
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Injected securely into test execution sandboxes and Playwright automation workers.
                  </p>
                </div>
                <span className="text-[10px] font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                  Encrypted at rest
                </span>
              </div>

              <div className="space-y-2">
                {Object.keys(settings.auto_repair?.env_vars || {}).length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">No custom sandbox environment variables configured yet.</p>
                ) : (
                  Object.entries(settings.auto_repair?.env_vars || {}).map(([key, val]) => {
                    const isRevealed = !!showEnvSecrets[key];
                    return (
                      <div key={key} className="flex items-center justify-between bg-slate-50/70 rounded-md border border-slate-200 px-3 py-1.5 text-xs">
                        <span className="font-mono font-bold text-slate-800">{key}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-500 max-w-[200px] truncate">
                            {isRevealed ? val : "••••••••••••"}
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowEnvSecrets((prev) => ({ ...prev, [key]: !prev[key] }))}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            title={isRevealed ? "Hide value" : "Reveal value"}
                          >
                            {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveEnvVar(key)}
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                            title="Remove variable"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  placeholder="KEY (e.g. NEXT_PUBLIC_API)"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                  className="w-1/2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                />
                <div className="relative w-1/2">
                  <input
                    type={showNewEnvVal ? "text" : "password"}
                    placeholder="Value (Secret)"
                    value={newEnvVal}
                    onChange={(e) => setNewEnvVal(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 pr-7 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewEnvVal((prev) => !prev)}
                    className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    title={showNewEnvVal ? "Hide" : "Show"}
                  >
                    {showNewEnvVal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  type="button"
                  onClick={handleAddEnvVar}
                  variant="outline"
                  className="text-xs h-8 px-3 cursor-pointer"
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-600" />
                Delete project
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteConfirmName("");
                  setDeleteError(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                This permanently removes{" "}
                <span className="font-mono font-bold text-slate-900">{selectedRepo}</span> from the
                database, together with its stored settings, credentials, and run history.
              </p>
              <p className="text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                There is no undo. To use this repository again you will have to re-import it.
              </p>
              <div>
                <label className="font-bold text-slate-800 block mb-1">
                  Type <span className="font-mono">{selectedRepo}</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={selectedRepo}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-red-500"
                />
              </div>
              {deleteError && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteConfirmName("");
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs h-8 px-3"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleDeleteProject}
                disabled={isDeleting || deleteConfirmName.trim() !== selectedRepo}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs h-8 px-3 gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete permanently</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Connect New Repository Modal ---------------- */}
      {isAddRepoModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <GithubIcon className="h-4 w-4" />
                Connect New Repository
              </h3>
              <button
                type="button"
                onClick={() => setIsAddRepoModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConnectRepo} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-800 block mb-1">Repository Full Name (Owner/Repo)</label>
                <input
                  type="text"
                  placeholder="e.g. your-org/your-repo"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 block mb-1">Default Base Branch</label>
                <input
                  type="text"
                  placeholder="main"
                  value={newRepoBranch}
                  onChange={(e) => setNewRepoBranch(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 block mb-1">Framework</label>
                <select
                  value={newRepoFramework}
                  onChange={(e) => setNewRepoFramework(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-xs"
                >
                  <option value="nextjs">Next.js (App Router)</option>
                  <option value="vite">Vite / React</option>
                  <option value="remix">Remix</option>
                  <option value="nuxt">Nuxt / Vue</option>
                  <option value="static">Node / Static</option>
                </select>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddRepoModalOpen(false)}
                  className="text-xs h-8 cursor-pointer"
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 cursor-pointer">
                  Connect &amp; Load
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- Add Custom Role Modal ---------------- */}
      {isAddRoleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-sky-600" />
                Add Custom Role Persona
              </h3>
              <button
                type="button"
                onClick={() => setIsAddRoleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomRole} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-800 block mb-1">Role Identifier</label>
                <input
                  type="text"
                  placeholder="e.g. manager, editor, billing_lead"
                  value={newRoleKey}
                  onChange={(e) => setNewRoleKey(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 block mb-1">Email / Login</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={newRoleEmail}
                  onChange={(e) => setNewRoleEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 block mb-1">Password</label>
                <input
                  type="password"
                  placeholder="••••••••••••"
                  value={newRolePassword}
                  onChange={(e) => setNewRolePassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddRoleModalOpen(false)}
                  className="text-xs h-8 cursor-pointer"
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-sky-600 hover:bg-sky-700 text-white text-xs h-8 cursor-pointer">
                  Create Role
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- Manual Run Dispatcher Modal ---------------- */}
      {isRunModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Play className="h-4 w-4 text-emerald-600 fill-emerald-600" />
                  Trigger On-Demand Verification Run
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Execute Playwright test suites on any target branch, PR number, or specific commit SHA.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRunModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {runDispatchResult && (
              <div
                className={`rounded-lg p-3 text-xs border ${
                  runDispatchResult.status === "cached"
                    ? "bg-blue-50 border-blue-200 text-blue-900"
                    : runDispatchResult.status === "queued" || runDispatchResult.status === "running"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-red-50 border-red-200 text-red-900"
                }`}
              >
                <div className="flex items-center justify-between font-bold mb-1">
                  <span className="flex items-center gap-1.5">
                    {runDispatchResult.status === "cached" ? (
                      <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    {runDispatchResult.status === "cached" ? "Cache Hit! (Zero Token Burn)" : "Verification Dispatched"}
                  </span>
                  <Link
                    href={
                      runDispatchResult.run_id
                        ? `/dashboard/runs/${encodeURIComponent(runDispatchResult.run_id)}/analytics`
                        : `/dashboard/runs?repo=${encodeURIComponent(selectedRepo)}`
                    }
                    className="underline text-[11px] font-medium"
                  >
                    View Forensics &rarr;
                  </Link>
                </div>
                <p>{runDispatchResult.message || "Run successfully submitted."}</p>
                {runDispatchResult.tokens_saved_estimate && (
                  <p className="text-[11px] text-blue-700 mt-1 font-semibold">
                    Saved ~{runDispatchResult.tokens_saved_estimate.toLocaleString()} LLM tokens and container boot time.
                  </p>
                )}
              </div>
            )}

            <form onSubmit={handleDispatchRun} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-800 block mb-1">Target Branch / Ref</label>
                  <input
                    type="text"
                    value={runBranch}
                    onChange={(e) => setRunBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-800 block mb-1">Pull Request # (Optional)</label>
                  <input
                    type="text"
                    value={runPrNumber}
                    onChange={(e) => setRunPrNumber(e.target.value)}
                    placeholder="e.g. 42"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-800 block mb-1">Commit SHA or Range</label>
                <input
                  type="text"
                  value={runSha}
                  onChange={(e) => setRunSha(e.target.value)}
                  placeholder="HEAD or 7-character commit SHA"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
                  required
                />
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Tip: Leave as 'HEAD' to automatically evaluate the newest commit on the target branch.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-800 block mb-1">Testing Scope</label>
                  <select
                    value={runScope}
                    onChange={(e) => setRunScope(e.target.value as "changed" | "full")}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-xs"
                  >
                    <option value="changed">Changed (Diff-Adjacent Journeys)</option>
                    <option value="full">Full (Platform Regression Sweep)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-800 block mb-1">Test Depth</label>
                  <select
                    value={runTestType}
                    onChange={(e) => setRunTestType(e.target.value as "functional" | "functional + visual")}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-xs"
                  >
                    <option value="functional">Functional Testing</option>
                    <option value="functional + visual">Functional + Visual Defect Spotting</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Force Re-run (Bypass Cache)</span>
                  <span className="text-[10px] text-slate-500 block">
                    Bypasses existing verified cache records and performs full container evaluation.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={runForce}
                  onChange={(e) => setRunForce(e.target.checked)}
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRunModalOpen(false)}
                  className="text-xs h-8 cursor-pointer"
                >
                  Close
                </Button>
                <Button
                  type="submit"
                  disabled={isDispatchingRun}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 gap-1.5 cursor-pointer"
                >
                  {isDispatchingRun ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Dispatching...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>Launch Verification</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
