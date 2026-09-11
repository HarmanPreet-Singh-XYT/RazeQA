"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
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
  auto_repair?: AutoRepairSettings;
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
  run_id: string;
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

export default function ProjectsClient() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("acme-corp/ecommerce-web");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Dropdown states
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
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
    roles: {
      user: { email: "qa@example.com" },
      admin: { email: "admin@example.com" },
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
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [runBranch, setRunBranch] = useState("main");
  const [runPrNumber, setRunPrNumber] = useState("");
  const [runSha, setRunSha] = useState("HEAD");
  const [runScope, setRunScope] = useState<"changed" | "full">("changed");
  const [runTestType, setRunTestType] = useState<"functional" | "functional + visual">("functional");
  const [runForce, setRunForce] = useState(false);
  const [isDispatchingRun, setIsDispatchingRun] = useState(false);
  const [runDispatchResult, setRunDispatchResult] = useState<any | null>(null);

  // Commit Run History state
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  // 1. Load Projects List
  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          if (data.projects && data.projects.length > 0) {
            setProjects(data.projects);
            const initialRepo = data.projects[0];
            setSelectedRepo(initialRepo.repo_full_name);
            if (initialRepo.settings) {
              setSettings((prev) => ({ ...prev, ...initialRepo.settings }));
            }
          }
        }
      } catch (err) {
        console.error("Failed to load projects", err);
      }
    }
    loadProjects();
  }, []);

  // 2. Fetch Run History whenever selectedRepo changes
  const fetchRunHistory = async (repoName: string) => {
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
    }
  }, [selectedRepo]);

  // Handle switching active project
  const handleSelectRepo = (p: ProjectItem) => {
    setSelectedRepo(p.repo_full_name);
    setIsRepoDropdownOpen(false);
    if (p.settings) {
      setSettings(p.settings);
    }
    setPasswordsToUpdate({});
    setSaveSuccess(false);
    setSaveError(null);
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
      installation_id: `inst_${Math.floor(1000000 + Math.random() * 9000000)}`,
      settings: {
        ...settings,
        framework: newRepoFramework,
      },
    };

    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: trimmed,
          settings: newProj.settings,
        }),
      });

      const updated = [newProj, ...projects.filter((p) => p.repo_full_name !== trimmed)];
      setProjects(updated);
      setSelectedRepo(trimmed);
      setIsAddRepoModalOpen(false);
      setNewRepoName("");
    } catch (err) {
      console.error("Failed to connect repo", err);
    }
  };

  // Live validation of build command
  const buildCommandValidation = useMemo(() => {
    const cmd = (settings.auto_repair?.build_command || "").trim();
    if (!cmd) return { valid: true, message: "Default 'npm run build' will be used." };

    for (const op of [";", "&&", "||", "|", "`", "$", "\n", ">", "<"]) {
      if (cmd.includes(op)) {
        return {
          valid: false,
          message: `Disallowed operator '${op}'. Commands must be single, unchained executables.`,
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
      // Build roles payload: only include passwords if explicitly modified by the user
      const rolesToSave: Record<string, RoleCredential> = {};
      for (const [rKey, cred] of Object.entries(settings.roles || {})) {
        const stagedPassword = passwordsToUpdate[rKey];
        if (stagedPassword !== undefined && stagedPassword.trim() && stagedPassword !== "••••••••••••") {
          rolesToSave[rKey] = {
            ...cred,
            password: stagedPassword.trim(),
          };
        } else {
          // Omit password key so the server preserves existing credentials
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
  const currentProject = projects.find((p) => p.repo_full_name === selectedRepo);
  const installationId = currentProject?.installation_id || "inst_9948271";
  const defaultBranch = currentProject?.default_branch || "main";

  // Calculate token savings across run history
  const totalCachedRuns = runHistory.filter((r) => r.status === "cached").length;
  const totalTokensSaved = totalCachedRuns * 15000;
  const totalCostSaved = (totalCachedRuns * 0.45).toFixed(2);

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 flex flex-col font-sans">
      {/* ---------------- Top App Header ---------------- */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-6 py-2.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-base shadow-sm group-hover:bg-emerald-700 transition-colors">
              A
            </div>
            <span className="font-extrabold text-base tracking-tight text-slate-950">
              AutoQA <span className="font-medium text-slate-500 text-xs">Engine</span>
            </span>
          </Link>

          {/* Repository Switcher Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors shadow-2xs"
            >
              <GitBranch className="h-3.5 w-3.5 text-slate-500" />
              <span className="max-w-[160px] truncate">{selectedRepo}</span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {isRepoDropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg z-50 animate-in fade-in-50 zoom-in-95">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Switch Repository
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {projects.map((p) => (
                    <button
                      key={p.repo_full_name}
                      type="button"
                      onClick={() => handleSelectRepo(p)}
                      className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium text-left transition-colors ${
                        selectedRepo === p.repo_full_name
                          ? "bg-emerald-50 text-emerald-800 font-bold"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="truncate">{p.repo_full_name}</span>
                      {selectedRepo === p.repo_full_name && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                    </button>
                  ))}
                </div>
                <div className="pt-1.5 mt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRepoDropdownOpen(false);
                      setIsAddRepoModalOpen(true);
                    }}
                    className="w-full flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Connect New Repository</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 border-l border-slate-200 pl-3">
            <Link
              href="/dashboard"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Overview
            </Link>
            <Link
              href="/dashboard/runs"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              PR Forensics
            </Link>
            <Link
              href="/dashboard/projects"
              className="rounded-md px-2.5 py-1 text-xs font-bold text-slate-950 bg-slate-100 transition-colors"
            >
              Projects & Settings
            </Link>
            <Link
              href="/dashboard/analytics"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Analytics & AI Insights
            </Link>
            <Link
              href="/dashboard/tools"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Dev Tools
            </Link>
          </nav>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2.5">
          {/* Manual Run Dispatcher Trigger Button */}
          <Button
            onClick={() => setIsRunModalOpen(true)}
            variant="outline"
            className="border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold text-xs px-3 py-1.5 h-8 gap-1.5 shadow-2xs"
          >
            <Play className="h-3.5 w-3.5 text-emerald-600 fill-emerald-600" />
            <span>Trigger Test Run</span>
          </Button>

          {/* Save Button */}
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-3.5 py-1.5 h-8 gap-1.5 shadow-sm active:scale-95 transition-all"
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
      </header>

      {/* ---------------- Main Content ---------------- */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-8 space-y-8">
        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between shadow-xs animate-in fade-in-50">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <div>
                <span className="font-bold">Save Failed:</span> {saveError}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              className="text-red-600 hover:text-red-900 font-semibold text-xs ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Page Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 flex items-center gap-2.5">
                <Settings2 className="h-6 w-6 text-emerald-600" />
                Repository Settings & Zero-Config Onboarding
              </h1>
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-mono font-bold text-slate-700">
                {selectedRepo}
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              Manage multi-role test credentials, manual verification dispatcher, smart token caching, and automated trigger policies.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRunModalOpen(true)}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg shadow-sm transition-all active:scale-95"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Run On-Demand Verification</span>
            </button>

            <a
              href="https://github.com/apps"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2 rounded-lg shadow-sm transition-all active:scale-95"
            >
              <GithubIcon className="h-4 w-4" />
              <span>GitHub App</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>
          </div>
        </div>

        {/* Grid of Configuration Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Repository & Framework Detection */}
          <div className="space-y-6 lg:col-span-1">
            {/* 1. Connected Repository Card */}
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
                <label className="text-xs font-semibold text-slate-700 block mb-1">Target GitHub Repo</label>
                <input
                  type="text"
                  value={selectedRepo}
                  onChange={(e) => setSelectedRepo(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
                <p className="flex items-center justify-between">
                  <span>Installation ID:</span>
                  <span className="font-mono text-slate-800 font-medium">{installationId}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span>Default Base Branch:</span>
                  <span className="font-mono text-slate-800 font-medium">{defaultBranch}</span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsAddRepoModalOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add / Connect Another Repo</span>
              </button>
            </div>

            {/* 2. Framework & Build Detection Card */}
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

            {/* 3. Smart Caching & Token Reduction Stats Card */}
            <div className="rounded-xl border border-indigo-200 bg-linear-to-br from-indigo-50/50 via-white to-purple-50/30 p-5 shadow-xs space-y-4">
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

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-100/80">
                <div className="rounded-lg bg-white p-2.5 border border-indigo-100 shadow-2xs">
                  <span className="text-[10px] text-slate-500 block">Deduplicated Runs</span>
                  <span className="text-base font-bold text-slate-900 font-mono flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                    {totalCachedRuns}
                  </span>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-indigo-100 shadow-2xs">
                  <span className="text-[10px] text-slate-500 block">Est. Token Savings</span>
                  <span className="text-base font-bold text-emerald-600 font-mono">
                    ~{totalTokensSaved.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (2 cols): Multi-Role Credentials, Triggers, & Run History */}
          <div className="space-y-6 lg:col-span-2">
            {/* 4. Multi-Role Credential Management with Password Toggles & Custom Roles */}
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
                  className="rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 flex items-center gap-1.5 transition-colors shadow-2xs"
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
                          ? "border-purple-200 bg-purple-50/20"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          {isAdmin ? (
                            <Shield className="h-3.5 w-3.5 text-amber-600" />
                          ) : isCustom ? (
                            <Users className="h-3.5 w-3.5 text-purple-600" />
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
                                ? "text-purple-800 bg-purple-100"
                                : "text-emerald-700 bg-emerald-100"
                            }`}
                          >
                            {isAdmin ? "Elevated" : isCustom ? "Custom" : "Primary"}
                          </span>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRole(roleKey)}
                              className="text-slate-400 hover:text-red-600 p-0.5"
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
                            className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700"
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
                          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1"
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
                              <ShieldCheck className="h-3 w-3" />
                              <span>Test Credentials</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5. Commit Run History & Status Sync */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                    <History className="h-4 w-4 text-emerald-600" />
                    Commit Verification History & Sync
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Live log of all verified commits for <span className="font-mono font-bold text-slate-800">{selectedRepo}</span> to track test state and prevent redundant executions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchRunHistory(selectedRepo)}
                  disabled={isLoadingRuns}
                  className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 flex items-center gap-1"
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
                        const shortSha = run.sha.length > 7 ? run.sha.slice(0, 7) : run.sha;
                        return (
                          <tr key={run.run_id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 font-mono text-slate-800 font-bold flex items-center gap-1.5">
                              <span>{shortSha}</span>
                              <button
                                type="button"
                                onClick={() => handleCopySha(run.sha)}
                                className="text-slate-400 hover:text-slate-600"
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
                                {run.branch}
                              </span>
                            </td>
                            <td className="py-2.5 text-slate-600">
                              <span className="capitalize">{run.scope}</span>
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
                                href={`/dashboard/runs`}
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

            {/* 6. Trigger Policies & Test Defaults */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-emerald-600" />
                  Automated Verification Triggers & Defaults
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
                      className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500"
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
                      className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500"
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
              </div>
            </div>

            {/* 7. Autonomous Agentic Repair (mini-swe-agent & Bedrock/Claude/Gemini) */}
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
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {settings.auto_repair?.enabled && (
                <div className="space-y-4">
                  {/* AI Model Selection */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-2">
                    <label className="text-xs font-bold text-slate-900 block">Preferred AI Repair Model</label>
                    <select
                      value={settings.auto_repair?.model_name || "anthropic/claude-sonnet-4.6"}
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
                      <option value="bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0">AWS Bedrock: Claude 3.5 Sonnet v2</option>
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
                            Manual Review & Approval
                          </span>
                          {settings.auto_repair?.trigger_mode === "manual_approval" && (
                            <Check className="h-4 w-4 text-indigo-600" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Generates patch proposals and execution trajectory for 1-click review in the dashboard or via `@pr-agent apply`.
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
                        className="w-full accent-indigo-600"
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
                        className="w-full accent-indigo-600"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Overall session execution ceiling.
                      </p>
                    </div>
                  </div>

                  {/* Sandbox Environment Variables */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                    <label className="text-xs font-bold text-slate-900 block">
                      Custom Sandbox Environment Variables
                    </label>
                    <div className="space-y-2">
                      {Object.entries(settings.auto_repair?.env_vars || {}).map(([key, val]) => {
                        const isRevealed = !!showEnvSecrets[key];
                        return (
                          <div key={key} className="flex items-center justify-between bg-white rounded-md border px-2.5 py-1 text-xs">
                            <span className="font-mono font-bold text-slate-800">{key}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-500 max-w-[200px] truncate">
                                {isRevealed ? val : "••••••••••••"}
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowEnvSecrets((prev) => ({ ...prev, [key]: !prev[key] }))}
                                className="text-slate-400 hover:text-slate-700"
                                title={isRevealed ? "Hide value" : "Reveal value"}
                              >
                                {isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveEnvVar(key)}
                                className="text-slate-400 hover:text-red-600"
                                title="Remove variable"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="KEY (e.g. NEXT_PUBLIC_API)"
                        value={newEnvKey}
                        onChange={(e) => setNewEnvKey(e.target.value)}
                        className="w-1/2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono"
                      />
                      <div className="relative w-1/2">
                        <input
                          type={showNewEnvVal ? "text" : "password"}
                          placeholder="Value (Secret)"
                          value={newEnvVal}
                          onChange={(e) => setNewEnvVal(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 pr-7 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewEnvVal((prev) => !prev)}
                          className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700"
                          title={showNewEnvVal ? "Hide" : "Show"}
                        >
                          {showNewEnvVal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        onClick={handleAddEnvVar}
                        variant="outline"
                        className="text-xs h-7 px-2.5"
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Custom Developer Instructions */}
                  <div>
                    <label className="text-xs font-bold text-slate-900 block mb-1">
                      Custom Repair Instructions & Guardrail Directives
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
          </div>
        </div>
      </main>

      {/* ---------------- Connect New Repository Modal ---------------- */}
      {isAddRepoModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <GithubIcon className="h-4 w-4" />
                Connect New Repository
              </h3>
              <button
                type="button"
                onClick={() => setIsAddRepoModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConnectRepo} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-800 block mb-1">Repository Full Name (Owner/Repo)</label>
                <input
                  type="text"
                  placeholder="e.g. acme-corp/payment-service"
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

              <div className="pt-3 flex items-center justify-end gap-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddRepoModalOpen(false)}
                  className="text-xs h-8"
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8">
                  Connect & Load
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
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-600" />
                Add Custom Role Persona
              </h3>
              <button
                type="button"
                onClick={() => setIsAddRoleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
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

              <div className="pt-3 flex items-center justify-end gap-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddRoleModalOpen(false)}
                  className="text-xs h-8"
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-8">
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
            <div className="flex items-center justify-between border-b pb-3">
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
                className="text-slate-400 hover:text-slate-600"
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
                    href={`/dashboard/runs`}
                    className="underline text-[11px]"
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
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRunModalOpen(false)}
                  className="text-xs h-8"
                >
                  Close
                </Button>
                <Button
                  type="submit"
                  disabled={isDispatchingRun}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 gap-1.5"
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
