"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  GitBranch,
  ExternalLink,
  Sparkles,
  RefreshCw,
  Check,
  Terminal,
  Layers,
  Code2,
  Cpu,
  Globe,
  Upload,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";

interface RepoItem {
  name: string;
  repo: string;
  defaultBranch: string;
  updatedAt: string;
  preset: string;
}

const TEMPLATES = [
  {
    id: "e-commerce",
    title: "E-Commerce Journey Suite",
    desc: "Automated testing for shopping cart, checkout flow, payment webhook, and inventory decrement.",
    icon: Sparkles,
    badge: "E-Commerce",
  },
  {
    id: "auth",
    title: "Multi-Role Auth Harness",
    desc: "Verifies session persistence, JWT cookies, role permissions (Admin vs User), and password reset.",
    icon: Terminal,
    badge: "Auth",
  },
  {
    id: "nextjs",
    title: "Next.js Fullstack Explorer",
    desc: "DOM traversal, Server Actions assertions, SSR hydration check, and visual regression diffing.",
    icon: Layers,
    badge: "Next.js",
  },
  {
    id: "i18n",
    title: "i18n Localization Verification",
    desc: "Crawls multiple locales and verifies text translation boundaries without layout shift.",
    icon: Code2,
    badge: "i18n",
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const { userEmail, setActiveRepo, refreshProjects } = useDashboard();

  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<RepoItem | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [promptInput, setPromptInput] = useState("");

  // Configure form fields
  const [projectName, setProjectName] = useState("");
  const [preset, setPreset] = useState("Next.js");
  const [rootDirectory, setRootDirectory] = useState("./");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [outputDirectory, setOutputDirectory] = useState(".next");
  const [installCommand, setInstallCommand] = useState("npm install");
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  // Accordion states
  const [isBuildSettingsOpen, setIsBuildSettingsOpen] = useState(false);
  const [isEnvVarsOpen, setIsEnvVarsOpen] = useState(false);

  // Deploying / streaming
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);
  const [deploymentDone, setDeploymentDone] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Fetch real repositories from GitHub App and Supabase projects
  useEffect(() => {
    async function loadRepositories() {
      setIsLoadingRepos(true);
      try {
        const [ghRes, pRes] = await Promise.all([
          fetch("/api/github/repos").catch(() => null),
          fetch("/api/projects").catch(() => null),
        ]);

        const discovered: RepoItem[] = [];

        if (ghRes && ghRes.ok) {
          const ghData = await ghRes.json();
          const ghList = ghData.repositories || [];
          for (const item of ghList) {
            discovered.push({
              name: item.repo_name || item.repo_full_name?.split("/")[1] || item.repo_full_name,
              repo: item.repo_full_name,
              defaultBranch: item.default_branch || "main",
              updatedAt: "Active",
              preset: "Next.js",
            });
          }
        }

        if (pRes && pRes.ok) {
          const pData = await pRes.json();
          const pList = pData.projects || [];
          for (const proj of pList) {
            if (!discovered.some((d) => d.repo === proj.repo_full_name)) {
              discovered.push({
                name: proj.repo_full_name.split("/")[1] || proj.repo_full_name,
                repo: proj.repo_full_name,
                defaultBranch: proj.default_branch || "main",
                updatedAt: proj.updated_at || "Configured",
                preset: proj.settings?.framework || "Next.js",
              });
            }
          }
        }

        setRepos(discovered);
      } catch (err) {
        console.error("Failed to load repositories:", err);
      } finally {
        setIsLoadingRepos(false);
      }
    }

    loadRepositories();
  }, []);

  const handleSelectRepo = (repo: RepoItem) => {
    setSelectedRepo(repo);
    setProjectName(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
    setPreset(repo.preset);
  };

  const handleAddEnvVar = () => {
    if (!envKey.trim()) return;
    setEnvVars([...envVars, { key: envKey.trim(), value: envValue }]);
    setEnvKey("");
    setEnvValue("");
  };

  const handleDeploy = async () => {
    if (!selectedRepo) return;
    setIsDeploying(true);
    setDeploymentLogs([]);
    setDeploymentDone(false);
    setDeployError(null);

    const log = (msg: string) => {
      setDeploymentLogs((prev) => [...prev, msg]);
    };

    try {
      log(`Initializing AutoQA workspace for ${selectedRepo.repo}...`);
      await new Promise((r) => setTimeout(r, 400));
      log(`Target default branch: ${selectedRepo.defaultBranch}`);
      log(`Framework profile: ${preset}`);
      log(`Build command: ${buildCommand}`);

      // Save project configuration in Supabase
      const envRecord: Record<string, string> = {};
      envVars.forEach((ev) => {
        envRecord[ev.key] = ev.value;
      });

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: selectedRepo.repo,
          settings: {
            framework: preset.toLowerCase(),
            package_manager: "npm",
            build_command: buildCommand,
            start_command: "npm start",
            port: 3000,
            scope: "changed",
            test_type: "functional",
            enable_on_push: true,
            enable_on_pr: true,
            auto_repair: {
              enabled: true,
              build_command: buildCommand,
              test_command: "npm test",
              max_steps: 10,
              cost_limit_usd: 1.0,
              wall_time_limit_seconds: 180,
              custom_instructions: "",
              env_vars: envRecord,
            },
            testing: {
              testing_instructions: "",
              enable_login_flow: true,
            },
          },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to register project settings");
      }

      await refreshProjects();
      setActiveRepo(selectedRepo.repo);

      log("Synchronized project settings with platform database.");
      await new Promise((r) => setTimeout(r, 350));
      log("AutoQA autonomous test harness configured.");
      log("Ready for test runs and webhook triggers.");
      setDeploymentDone(true);
    } catch (err: any) {
      console.error("Deploy error:", err);
      setDeployError(err?.message || "Failed to initialize project");
      log(`Error: ${err?.message || "Failed to initialize project"}`);
    } finally {
      setIsDeploying(false);
    }
  };

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.repo.toLowerCase().includes(repoSearch.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-200 mb-8">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 hover:text-slate-900 transition-colors font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </Link>
          <span>/</span>
          <span className="text-slate-900 font-semibold">New Project</span>
        </div>
      </div>

      {/* VIEW A: Import & Template Selection */}
      {!selectedRepo ? (
        <div className="space-y-10 animate-in fade-in duration-200">
          {/* Hero Section */}
          <div className="space-y-4">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Connect a project for automated testing
            </h1>

            {/* Prompt bar */}
            <div className="relative">
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2.5 focus-within:border-slate-900 focus-within:bg-white transition-all">
                <span className="text-slate-400 font-mono text-sm">+</span>
                <input
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="Ask AutoQA to test a flow, or enter a Git repository URL..."
                  className="w-full bg-transparent text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              {/* Suggestions Pills */}
              <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
                {["Checkout Journey", "Auth & Cookie Persistence", "i18n Localization", "Form Validation"].map((pill) => (
                  <button
                    key={pill}
                    onClick={() => setPromptInput(`Explore and verify ${pill} across all PR branches`)}
                    className="px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-100 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <span>{pill}</span>
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Select an installed repository below or choose a journey template to initialize AutoQA.
            </p>
          </div>

          {/* Two-Column Grid: Import Git Repository vs Build Solution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Left Column: Import Git Repository */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Import Git Repository</h2>
                <span className="text-[11px] font-mono text-slate-400">
                  {repos.length} installed
                </span>
              </div>

              {/* GitHub Account Selector & Search */}
              <div className="flex items-center gap-2">
                <div className="relative shrink-0">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-100 border border-slate-200 text-xs font-medium text-slate-800">
                    <span>{userEmail ? userEmail.split("@")[0] : "GitHub"}</span>
                  </div>
                </div>
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
                  />
                </div>
              </div>

              {/* Repository List */}
              <div className="space-y-1.5 pt-1 max-h-80 overflow-y-auto">
                {isLoadingRepos ? (
                  <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading repositories...</span>
                  </div>
                ) : filteredRepos.length > 0 ? (
                  filteredRepos.map((repo) => (
                    <div
                      key={repo.repo}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300 transition-all group"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {repo.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono">{repo.repo}</span>
                          <span>•</span>
                          <span>{repo.defaultBranch}</span>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        onClick={() => handleSelectRepo(repo)}
                        className="bg-slate-900 text-white hover:bg-slate-800 text-xs font-medium h-7 px-3 rounded shrink-0 cursor-pointer shadow-xs"
                      >
                        Import
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg text-xs text-slate-500 space-y-2">
                    <p>No repositories found matching your query.</p>
                    <p className="text-[11px] text-slate-400">
                      Enter a custom repo name above or import from templates.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Build your solution Templates */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Journey Test Templates</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>Pre-configured suites</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TEMPLATES.map((tmpl) => {
                  const Icon = tmpl.icon;
                  return (
                    <div
                      key={tmpl.id}
                      onClick={() =>
                        handleSelectRepo({
                          name: tmpl.title.toLowerCase().replace(/\s+/g, "-"),
                          repo: `workspace/${tmpl.title.toLowerCase().replace(/\s+/g, "-")}`,
                          defaultBranch: "main",
                          updatedAt: "Today",
                          preset: "Next.js",
                        })
                      }
                      className="p-3.5 rounded-lg border border-slate-200 bg-white hover:border-slate-400 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between h-36"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-slate-900 group-hover:text-slate-950">
                            {tmpl.title}
                          </span>
                          <span className="text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-200 px-1 py-0.2 rounded">
                            {tmpl.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                          {tmpl.desc}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500 group-hover:text-slate-900">
                        <span className="flex items-center gap-1">
                          <Icon className="h-3.5 w-3.5 text-slate-700" />
                          <span>Template</span>
                        </span>
                        <span className="font-semibold text-slate-700">Use →</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* VIEW B: New Project Configuration & Deploy */
        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6 shadow-sm">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Configure Project</h1>
              <p className="text-xs text-slate-500 mt-1">
                Customize test environment settings, build triggers, and sandbox configuration.
              </p>
            </div>

            {/* Importing from GitHub Banner */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2.5 min-w-0">
                <GitBranch className="h-4 w-4 text-slate-700 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] font-mono text-slate-500 block">Importing repository</span>
                  <span className="text-xs font-semibold text-slate-900 font-mono truncate block">
                    {selectedRepo.repo}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono bg-white text-slate-700 border border-slate-200 px-2 py-0.5 rounded">
                {selectedRepo.defaultBranch}
              </span>
            </div>

            {/* Form Fields */}
            <div className="space-y-4 text-xs">
              {/* Workspace & Project Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1.5">
                    AutoQA Workspace
                  </label>
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-slate-900">
                    <span className="truncate">{userEmail ? userEmail.split("@")[0] : "workspace"}</span>
                    <span className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 px-1 py-0.2 rounded">
                      Standard
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1.5">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              {/* Application Preset */}
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1.5">
                  Application Preset
                </label>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-slate-900 cursor-pointer"
                >
                  <option value="Next.js">Next.js</option>
                  <option value="Vite">Vite / React</option>
                  <option value="Remix">Remix</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Root Directory */}
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1.5">
                  Root Directory
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={rootDirectory}
                    onChange={(e) => setRootDirectory(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-slate-900 font-mono"
                  />
                </div>
              </div>

              {/* Accordion: Build and Output Settings */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsBuildSettingsOpen(!isBuildSettingsOpen)}
                  className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="font-medium text-slate-900">Build and Output Settings</span>
                  {isBuildSettingsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {isBuildSettingsOpen && (
                  <div className="p-3 bg-white border-t border-slate-200 space-y-3">
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Build Command</label>
                      <input
                        type="text"
                        value={buildCommand}
                        onChange={(e) => setBuildCommand(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Output Directory</label>
                      <input
                        type="text"
                        value={outputDirectory}
                        onChange={(e) => setOutputDirectory(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Install Command</label>
                      <input
                        type="text"
                        value={installCommand}
                        onChange={(e) => setInstallCommand(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Accordion: Environment Variables */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsEnvVarsOpen(!isEnvVarsOpen)}
                  className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="font-medium text-slate-900">Environment Variables</span>
                  {isEnvVarsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {isEnvVarsOpen && (
                  <div className="p-3 bg-white border-t border-slate-200 space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="KEY_NAME"
                        value={envKey}
                        onChange={(e) => setEnvKey(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                      <input
                        type="password"
                        placeholder="value"
                        value={envValue}
                        onChange={(e) => setEnvValue(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddEnvVar}
                        className="bg-slate-900 text-white hover:bg-slate-800 text-xs h-7 px-3"
                      >
                        Add
                      </Button>
                    </div>
                    {envVars.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {envVars.map((v, i) => (
                          <div key={i} className="flex items-center justify-between px-2 py-1 bg-slate-100 rounded text-[11px] font-mono">
                            <span className="text-slate-900">{v.key}</span>
                            <span className="text-slate-400">••••••••</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Error message */}
            {deployError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{deployError}</span>
              </div>
            )}

            {/* Deploy / Initialize Button */}
            <div className="pt-2 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setSelectedRepo(null)}
                disabled={isDeploying}
                className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs h-10 px-4"
              >
                Back
              </Button>
              <Button
                disabled={isDeploying}
                onClick={handleDeploy}
                className="flex-1 bg-slate-900 text-white hover:bg-slate-800 font-semibold text-xs py-2.5 rounded-md cursor-pointer transition-all shadow-sm active:scale-[0.99]"
              >
                {isDeploying ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                    Initializing AutoQA Test Suite...
                  </>
                ) : (
                  "Initialize AutoQA Project"
                )}
              </Button>
            </div>
          </div>

          {/* Initialization Progress Box */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Test Harness Activity
            </h2>
            {deploymentLogs.length === 0 && !isDeploying ? (
              <p className="text-xs text-slate-500">
                Click above to connect this repository and establish your autonomous test harness.
              </p>
            ) : (
              <div className="bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-3 font-mono text-[11px] space-y-1.5 max-h-48 overflow-y-auto">
                {deploymentLogs.map((l, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 ${
                      l.toLowerCase().includes("ready") || l.toLowerCase().includes("synchronized")
                        ? "text-emerald-400"
                        : l.toLowerCase().includes("error")
                        ? "text-red-400"
                        : "text-slate-300"
                    }`}
                  >
                    <span className="text-slate-500">&gt;</span>
                    <span>{l}</span>
                  </div>
                ))}
                {isDeploying && (
                  <div className="flex items-center gap-2 text-sky-400 animate-pulse">
                    <span className="text-slate-500">&gt;</span>
                    <span>Configuring preview sandbox...</span>
                  </div>
                )}
              </div>
            )}

            {deploymentDone && (
              <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600" />
                  <span className="font-medium">Project initialized and ready for automated testing!</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => router.push("/dashboard")}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 text-xs h-7 px-3 shadow-xs"
                >
                  Go to Dashboard →
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
