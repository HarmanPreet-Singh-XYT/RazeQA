"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  GitBranch,
  Terminal,
  Play,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface OnboardingWizardProps {
  onCompleted: () => void;
  userEmail?: string;
}

export function OnboardingWizard({ onCompleted, userEmail }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [repoName, setRepoName] = useState("");
  const [branch, setBranch] = useState("main");
  const [framework, setFramework] = useState("nextjs");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [testCommand, setTestCommand] = useState("npm test");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub App repositories discovery
  const [installedRepos, setInstalledRepos] = useState<any[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [useManualInput, setUseManualInput] = useState(false);

  useEffect(() => {
    async function loadAppRepos() {
      setIsLoadingRepos(true);
      try {
        const res = await fetch("/api/github/repos");
        if (res.ok) {
          const data = await res.json();
          const repos = data.repositories || [];
          setInstalledRepos(repos);
          if (repos.length > 0) {
            setRepoName(repos[0].repo_full_name);
            setBranch(repos[0].default_branch || "main");
          } else {
            setUseManualInput(true);
          }
        } else {
          setUseManualInput(true);
        }
      } catch {
        setUseManualInput(true);
      } finally {
        setIsLoadingRepos(false);
      }
    }
    loadAppRepos();
  }, []);

  const selectPreset = (preset: "nextjs" | "vite" | "python" | "custom") => {
    setFramework(preset);
    if (preset === "nextjs") {
      setBuildCommand("npm run build");
      setTestCommand("npm test");
    } else if (preset === "vite") {
      setBuildCommand("npm run build");
      setTestCommand("npm test");
    } else if (preset === "python") {
      setBuildCommand("pytest");
      setTestCommand("pytest tests/");
    } else {
      setBuildCommand("npm run build");
      setTestCommand("npm test");
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      // 1. Create/Save project
      const projectPayload = {
        repo_full_name: repoName.trim(),
        default_branch: branch.trim() || "main",
        settings: {
          framework,
          scope: "changed",
          test_type: "functional",
          auto_repair: {
            build_command: buildCommand.trim(),
            test_command: testCommand.trim(),
            trigger_mode: "on_failure",
            max_steps: 10,
          },
        },
      };

      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectPayload),
      });

      if (!projectRes.ok) {
        const errJson = await projectRes.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to create project");
      }

      // 2. Trigger initial verification run
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoName.trim(),
          scope: "full",
          test_type: "functional",
        }),
      }).catch(() => {
        // Run trigger is optional if engine is standby
      });

      onCompleted();
    } catch (err: any) {
      setError(err?.message || "Setup failed. Please check parameters.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full py-8 px-4 animate-in fade-in-50 duration-300">
      {/* Header banner */}
      <div className="text-center mb-8 space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          <span>Welcome to RazeQA Platform</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
          Get started with your first repository
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          Connect your GitHub repository, configure minimal build &amp; test execution, and run your first autonomous PR verification in minutes.
        </p>
      </div>

      {/* Step Indicators */}
      <div className="flex items-center justify-between mb-8 px-6 relative">
        <div className="absolute left-10 right-10 top-1/2 -translate-y-1/2 h-0.5 bg-slate-200 -z-0" />
        
        {[
          { step: 1, label: "Connect Repo" },
          { step: 2, label: "Build & Test" },
          { step: 3, label: "Launch Run" },
        ].map((s) => {
          const isDone = currentStep > s.step;
          const isCurrent = currentStep === s.step;
          return (
            <div key={s.step} className="flex flex-col items-center gap-1.5 z-10">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors shadow-2xs ${
                  isDone
                    ? "bg-emerald-600 text-white"
                    : isCurrent
                    ? "bg-slate-950 text-white ring-4 ring-slate-100"
                    : "bg-white border-2 border-slate-300 text-slate-500"
                }`}
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : s.step}
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  isCurrent ? "text-slate-950" : "text-slate-500"
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Wizard Card Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* STEP 1: Connect Repository */}
        {currentStep === 1 && (
          <div className="space-y-5 animate-in fade-in-50">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-emerald-600" />
                  <span>Choose Your Target Repository</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {installedRepos.length > 0 && !useManualInput
                    ? "Select a repository discovered from your installed GitHub App, or switch to manual input."
                    : "Specify the repository (owner/repo) that RazeQA will monitor for automated PR testing."}
                </p>
              </div>
              {installedRepos.length > 0 && (
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 shrink-0">
                  {installedRepos.length} App {installedRepos.length === 1 ? "Repo" : "Repos"} Found
                </span>
              )}
            </div>

            {isLoadingRepos ? (
              <div className="py-8 text-center space-y-2">
                <RefreshCw className="h-5 w-5 animate-spin text-emerald-600 mx-auto" />
                <p className="text-xs text-slate-500">Discovering repositories from GitHub App...</p>
              </div>
            ) : installedRepos.length > 0 && !useManualInput ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  {installedRepos.map((r) => {
                    const isSelected = repoName === r.repo_full_name;
                    return (
                      <div
                        key={r.repo_full_name}
                        onClick={() => {
                          setRepoName(r.repo_full_name);
                          setBranch(r.default_branch || "main");
                        }}
                        className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-center justify-between ${
                          isSelected
                            ? "border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-500/20 shadow-xs"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                          }`}>
                            <GitBranch className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <span className="font-mono font-bold text-xs text-slate-900 block truncate">
                              {r.repo_full_name}
                            </span>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                              <span>Default branch: <code className="font-mono font-semibold text-slate-700">{r.default_branch || "main"}</code></span>
                              <span>•</span>
                              <span>{r.private ? "Private" : "Public"}</span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 ml-3">
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-white border border-emerald-200 px-2.5 py-1 rounded-md shadow-2xs">
                              <Check className="h-3.5 w-3.5" />
                              Selected
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-slate-500 hover:text-slate-900">
                              Select
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setUseManualInput(true)}
                    className="text-slate-500 hover:text-slate-900 underline font-medium"
                  >
                    Enter repository name manually
                  </button>
                  <a
                    href="https://github.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-500 hover:text-slate-900 flex items-center gap-1 font-medium"
                  >
                    <span>Install on more repos</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ) : (
              /* Manual Input View */
              <div className="space-y-4 pt-1">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                    Repository Name
                  </label>
                  <div className="relative">
                    <GitBranch className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="e.g. your-org/your-repo"
                      className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                    Default Base Branch
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
                  />
                </div>

                {installedRepos.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setUseManualInput(false)}
                      className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold underline"
                    >
                      ← Back to detected GitHub App repositories ({installedRepos.length})
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 flex items-center justify-between border-t border-slate-100">
              <Link
                href="/dashboard/projects"
                className="text-xs text-slate-500 hover:text-slate-800 font-medium"
              >
                Skip to dashboard →
              </Link>
              <Button
                type="button"
                onClick={() => {
                  if (!repoName.trim()) {
                    setError("Please select or provide a repository name.");
                    return;
                  }
                  setError(null);
                  setCurrentStep(2);
                }}
                className="bg-slate-950 hover:bg-slate-800 text-white font-semibold text-xs px-4 py-2 gap-1.5 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Minimal Build Config */}
        {currentStep === 2 && (
          <div className="space-y-5 animate-in fade-in-50">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-600" />
                <span>Build &amp; Test Configuration</span>
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                RazeQA runs your build inside a containerized sandbox. Choose a preset or specify your safe build binary.
              </p>
            </div>

            {/* Presets */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-2">
                Stack Presets
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: "nextjs", label: "Next.js / Node" },
                  { id: "vite", label: "Vite / React" },
                  { id: "python", label: "Python / Pytest" },
                  { id: "custom", label: "Custom" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPreset(p.id as any)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold text-center transition-all cursor-pointer ${
                      framework === p.id
                        ? "border-slate-900 bg-slate-900 text-white shadow-2xs"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Build Command
                </label>
                <input
                  type="text"
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  placeholder="npm run build"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Test Command (optional)
                </label>
                <input
                  type="text"
                  value={testCommand}
                  onChange={(e) => setTestCommand(e.target.value)}
                  placeholder="npm test"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900"
                />
              </div>
            </div>

            {/* Safe Binary Notice */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 flex items-start gap-2.5 text-[11px] text-slate-600">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800">Security allowlist:</span> Build commands are restricted to trusted package binaries (<code className="font-mono text-slate-800">npm</code>, <code className="font-mono text-slate-800">pnpm</code>, <code className="font-mono text-slate-800">yarn</code>, <code className="font-mono text-slate-800">pytest</code>, <code className="font-mono text-slate-800">python</code>). Shell operators (<code className="font-mono text-slate-800">;&amp;&amp;||</code>) are forbidden to prevent sandbox injection.
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCurrentStep(1)}
                className="text-xs px-3.5 py-2 cursor-pointer gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!buildCommand.trim()) {
                    setError("Please provide a build command.");
                    return;
                  }
                  setError(null);
                  setCurrentStep(3);
                }}
                className="bg-slate-950 hover:bg-slate-800 text-white font-semibold text-xs px-4 py-2 gap-1.5 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Launch First Run */}
        {currentStep === 3 && (
          <div className="space-y-5 animate-in fade-in-50">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Play className="h-4 w-4 text-emerald-600 fill-emerald-600" />
                <span>Ready to Launch Verification</span>
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Review your configuration below. We will save this project and immediately dispatch your initial verification run.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-slate-500">Repository</span>
                <span className="font-mono font-bold text-slate-900">{repoName}</span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-slate-500">Base Branch</span>
                <span className="font-mono font-bold text-slate-900">{branch}</span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-slate-500">Build Command</span>
                <code className="font-mono font-bold text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                  {buildCommand}
                </code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Auto-Repair Policy</span>
                <span className="font-medium text-emerald-700">Trigger on failure (Default)</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              Credentials, test personas, GitHub webhooks, and environment variables can be adjusted anytime under{" "}
              <Link href="/dashboard/projects" className="font-semibold text-slate-800 underline">
                Project Settings
              </Link>.
            </p>

            <div className="pt-4 flex items-center justify-between border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setCurrentStep(2)}
                className="text-xs px-3.5 py-2 cursor-pointer gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </Button>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={handleFinish}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-5 py-2 gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Launching first run…</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Save &amp; Trigger First Run</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
