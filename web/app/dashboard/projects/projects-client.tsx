"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  ExternalLink,
  GitBranch,
  KeyRound,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  User,
  Users,
  Workflow,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/login/actions";

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
  custom_instructions: string;
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

export default function ProjectsClient() {
  const [selectedRepo, setSelectedRepo] = useState("acme-corp/ecommerce-web");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Project form state
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
      enabled: true,
      trigger_mode: "automatic",
      build_command: "npm run build",
      test_command: "npm test",
      max_steps: 10,
      cost_limit_usd: 1.0,
      custom_instructions: "",
    },
    roles: {
      user: { email: "qa@example.com", password: "••••••••••••" },
      admin: { email: "admin@example.com", password: "••••••••••••" },
    },
  });

  const [userEmail, setUserEmail] = useState(settings.roles.user.email);
  const [userPassword, setUserPassword] = useState("");
  const [adminEmail, setAdminEmail] = useState(settings.roles.admin.email);
  const [adminPassword, setAdminPassword] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          if (data.projects && data.projects.length > 0) {
            const p = data.projects[0];
            setSelectedRepo(p.repo_full_name);
            if (p.settings) {
              setSettings((prev) => ({ ...prev, ...p.settings }));
              if (p.settings.roles?.user?.email) setUserEmail(p.settings.roles.user.email);
              if (p.settings.roles?.admin?.email) setAdminEmail(p.settings.roles.admin.email);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load projects", err);
      }
    }
    loadProjects();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updatedSettings = {
        ...settings,
        roles: {
          user: {
            email: userEmail,
            password: userPassword.trim() ? userPassword : (settings.roles?.user?.password || "••••••••••••"),
          },
          admin: {
            email: adminEmail,
            password: adminPassword.trim() ? adminPassword : (settings.roles?.admin?.password || "••••••••••••"),
          },
        },
      };

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: selectedRepo,
          settings: updatedSettings,
        }),
      });

      if (res.ok) {
        setSettings(updatedSettings);
        setUserPassword("");
        setAdminPassword("");
        setSaveSuccess(true);
        setSaveError(null);
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

          {/* Repo Switcher */}
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">
            <GitBranch className="h-3.5 w-3.5 text-slate-500" />
            <span>{selectedRepo}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
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

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>GitHub App: Active</span>
          </div>

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
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 flex items-center gap-2.5">
              <Settings2 className="h-6 w-6 text-emerald-600" />
              Repository Settings & Zero-Config Onboarding
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Manage GitHub App installations, multi-role test credentials, and automated trigger policies.
            </p>
          </div>

          <a
            href="https://github.com/apps"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-all active:scale-95"
          >
            <GithubIcon className="h-4 w-4" />
            <span>Install GitHub App</span>
            <ExternalLink className="h-3 w-3 opacity-70" />
          </a>
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
                  <span className="font-mono text-slate-800 font-medium">inst_9948271</span>
                </p>
                <p className="flex items-center justify-between">
                  <span>Default Branch:</span>
                  <span className="font-mono text-slate-800 font-medium">main</span>
                </p>
              </div>
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
          </div>

          {/* Right Column (2 cols): Multi-Role Credentials & Trigger Policies */}
          <div className="space-y-6 lg:col-span-2">
            {/* 3. Multi-Role Credential Management */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-emerald-600" />
                    Multi-Role Test Credentials (Encrypted at Rest)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Credentials are encrypted via Fernet and injected only into the isolated sandbox at boot.
                  </p>
                </div>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Never Plaintext
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Role 1: Default Test User */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-slate-600" />
                      Role: Default Customer / User
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100/60 rounded px-1.5 py-0.2">
                      Primary
                    </span>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Email / Login</label>
                    <input
                      type="email"
                      value={userEmail}
                      onChange={(e) => setUserEmail(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Password</label>
                    <input
                      type="password"
                      value={userPassword}
                      placeholder="•••••••••••• (Leave blank to keep existing)"
                      onChange={(e) => setUserPassword(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>

                {/* Role 2: Administrator Role */}
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5 text-amber-600" />
                      Role: Admin / Staff
                    </span>
                    <span className="text-[10px] font-semibold text-amber-800 bg-amber-100/80 rounded px-1.5 py-0.2">
                      Elevated
                    </span>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Admin Email</label>
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Admin Password</label>
                    <input
                      type="password"
                      value={adminPassword}
                      placeholder="•••••••••••• (Leave blank to keep existing)"
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Trigger Policies & Test Defaults */}
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

            {/* 5. Autonomous Agentic Repair (mini-swe-agent & AWS Bedrock) */}
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
                    checked={settings.auto_repair?.enabled ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_repair: {
                          ...(settings.auto_repair || {
                            enabled: true,
                            trigger_mode: "automatic",
                            build_command: "npm run build",
                            test_command: "npm test",
                            max_steps: 10,
                            cost_limit_usd: 1.0,
                            custom_instructions: "",
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

                  {/* Verification Command Inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-900 block mb-1">
                        Build Verification Command
                      </label>
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
                      <p className="text-[10px] text-slate-500 mt-1">
                        Agent runs this command in bash to verify syntax and typecheck before submitting.
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

                  {/* Guardrail & Cost Limits */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-900">
                          Max Repair Steps (Loop Limit)
                        </label>
                        <span className="font-mono text-xs font-bold text-indigo-600">
                          {settings.auto_repair?.max_steps || 10} steps
                        </span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={20}
                        step={1}
                        value={settings.auto_repair?.max_steps || 10}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              max_steps: parseInt(e.target.value),
                            },
                          })
                        }
                        className="w-full accent-indigo-600"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Circuit breaker: Halts immediately if the agent cannot resolve the failure within this limit.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-900">
                          Cost Budget Limit ($ USD)
                        </label>
                        <span className="font-mono text-xs font-bold text-emerald-600">
                          ${(settings.auto_repair?.cost_limit_usd || 1.0).toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="number"
                        min={0.25}
                        max={10.0}
                        step={0.25}
                        value={settings.auto_repair?.cost_limit_usd || 1.0}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            auto_repair: {
                              ...(settings.auto_repair!),
                              cost_limit_usd: parseFloat(e.target.value) || 1.0,
                            },
                          })
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono text-slate-800"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Hard stop if LLM token consumption reaches this spend threshold.
                      </p>
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
                      Instructions will be injected directly into the agent's task context during automated repair.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
