"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
  RefreshCw,
  Check,
  AlertCircle,
  ArrowRight,
  Lock,
  Globe,
  Settings2,
  Sparkles,
  KeyRound,
  Terminal,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";

function GithubIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

/**
 * A repository granted to the GitHub App. Discovery and import are separate
 * concerns on purpose: this list is read-only metadata until the user imports
 * one, at which point a `projects` row is created.
 */
interface AvailableRepo {
  repo_full_name: string;
  repo_name: string;
  default_branch: string;
  private: boolean;
  imported: boolean;
}

/** A repository already imported into RazeQA as a project. */
interface ConnectedProject {
  repo_full_name: string;
  default_branch: string;
  framework: string;
  created_at?: string;
}

/**
 * A progress entry is only ever appended after the step actually ran. There is
 * no simulated "Initializing workspace..." theatre: if a step is listed, it
 * happened; if it failed, the failure is the last thing the user sees.
 */
interface ProgressStep {
  label: string;
  state: "active" | "done" | "failed";
}

/**
 * GitHub App connection state for the signed-in user, as reported by
 * `/api/github/repos`. `connected: false` is not an error: it means the App is
 * configured for this deployment but this account has not installed it, and the
 * import picker must not be shown until it is.
 */
interface GitHubConnectionState {
  appConfigured: boolean;
  connected: boolean;
  connectUrl: string;
  /**
   * Whether this account has a linked GitHub identity. Ownership is proved with
   * the GitHub user id, so an email/password account that never linked GitHub
   * cannot be matched to an installation however many times it installs the App.
   */
  githubIdentityLinked: boolean;
}

/**
 * Shown when the deployment has a GitHub App but the signed-in account has not
 * installed it (or has not granted it any repositories).
 *
 * This is a required setup step, not an error and not an empty state, so it gets
 * its own screen. The repository picker would otherwise render as "No
 * repositories detected" — which reads as a bug — and offer a manual import
 * field that the server now rejects.
 */
function ConnectGitHubApp({
  connectUrl,
  githubIdentityLinked,
  awaitingInstall,
  isChecking,
  onRecheck,
}: {
  connectUrl: string;
  githubIdentityLinked: boolean;
  awaitingInstall: boolean;
  isChecking: boolean;
  onRecheck: () => void;
}) {
  const stepBadge =
    "h-5 w-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6 shadow-sm">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
            <AlertCircle className="h-3.5 w-3.5" />
            Setup required
          </span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Connect GitHub to import repositories
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            RazeQA reads your code through a GitHub App. Until it is installed on the
            account or organization that owns your repositories, there is nothing to
            import — so the repository picker stays locked.
          </p>
        </div>

        {!githubIdentityLinked && (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
            <p className="font-semibold">This account is not linked to GitHub</p>
            <p className="leading-relaxed">
              Ownership of an installation is proved with your GitHub user id, so this
              account cannot be matched to one yet. Sign out and use{" "}
              <span className="font-semibold">Continue with GitHub</span> on the sign-in
              page with the GitHub account that owns your repositories, then come back
              here.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              Go to sign-in
            </Link>
          </div>
        )}

        <ol className="space-y-3 text-xs text-slate-600">
          <li className="flex items-start gap-2.5">
            <span className={stepBadge}>1</span>
            <span>Install the RazeQA GitHub App on your account or organization.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className={stepBadge}>2</span>
            <span>
              Grant it access to the repositories you want tested. You can change the
              selection later from GitHub without reinstalling.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className={stepBadge}>3</span>
            <span>You are returned here and the repository picker unlocks.</span>
          </li>
        </ol>

        {awaitingInstall && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0 mt-0.5" />
            <span>
              Waiting for GitHub to confirm the installation. This usually takes a few
              seconds; the picker unlocks on its own once it lands.
            </span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <a
            href={connectUrl}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
          >
            <GithubIcon className="h-4 w-4" />
            Install GitHub App
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
          <Button
            type="button"
            variant="outline"
            onClick={onRecheck}
            disabled={isChecking}
            className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs h-10 px-4"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isChecking ? "animate-spin" : ""}`} />
            I have already installed it
          </Button>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Still blocked after installing? Check that the App was installed on the account
          that owns the repositories, and that it was granted at least one repository —
          RazeQA cannot import a repository the App has no access to.
        </p>

        <div className="pt-3 border-t border-slate-100">
          <Link
            href="/dashboard"
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  const router = useRouter();
  const { userEmail, setActiveRepo, refreshProjects } = useDashboard();

  const [available, setAvailable] = useState<AvailableRepo[]>([]);
  const [connected, setConnected] = useState<ConnectedProject[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [manualRepo, setManualRepo] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<AvailableRepo | null>(null);
  const [connection, setConnection] = useState<GitHubConnectionState | null>(null);
  /** True when we returned from GitHub's install page and are waiting on the webhook. */
  const [awaitingInstall, setAwaitingInstall] = useState(false);

  // Configure form fields
  const [projectName, setProjectName] = useState("");
  const [preset, setPreset] = useState("Next.js");
  const [rootDirectory, setRootDirectory] = useState("./");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [outputDirectory, setOutputDirectory] = useState(".next");
  const [installCommand, setInstallCommand] = useState("npm install");
  const [startCommand, setStartCommand] = useState("npm start");
  const [previewPort, setPreviewPort] = useState("3000");
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  // Testing policy. These are the same keys the engine reads at run time
  // (`settings.testing.*`, `settings.scope`, `settings.test_type`), so the
  // choices made here take effect on the first run instead of only after a
  // second visit to Project Settings.
  const [testScope, setTestScope] = useState<"changed" | "full">("changed");
  const [testType, setTestType] = useState<"functional" | "functional + visual">("functional");
  const [testingInstructions, setTestingInstructions] = useState("");
  const [enableLoginFlow, setEnableLoginFlow] = useState(true);

  // Test personas. Passwords are held in form state only and are cleared once
  // the import succeeds; nothing reads them back from the server.
  const [userRoleEmail, setUserRoleEmail] = useState("");
  const [userRolePassword, setUserRolePassword] = useState("");
  const [adminRoleEmail, setAdminRoleEmail] = useState("");
  const [adminRolePassword, setAdminRolePassword] = useState("");

  // Automated repair (the engine's repair agent reads `settings.auto_repair.*`).
  const [autoRepairEnabled, setAutoRepairEnabled] = useState(true);
  const [triggerMode, setTriggerMode] = useState<"automatic" | "manual_approval">("automatic");
  const [repairTestCommand, setRepairTestCommand] = useState("npm test");
  const [maxSteps, setMaxSteps] = useState("10");
  const [costLimit, setCostLimit] = useState("1.0");
  const [wallTimeLimit, setWallTimeLimit] = useState("180");
  const [repairInstructions, setRepairInstructions] = useState("");

  // Trigger policies
  const [enableOnPr, setEnableOnPr] = useState(true);
  const [enableOnPush, setEnableOnPush] = useState(true);

  // Accordion states
  const [isBuildSettingsOpen, setIsBuildSettingsOpen] = useState(false);
  const [isEnvVarsOpen, setIsEnvVarsOpen] = useState(false);
  const [isTestingPolicyOpen, setIsTestingPolicyOpen] = useState(false);
  const [isPersonasOpen, setIsPersonasOpen] = useState(false);
  const [isAutoRepairOpen, setIsAutoRepairOpen] = useState(false);

  // Import progress
  const [isImporting, setIsImporting] = useState(false);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  /** Machine-readable code from a failed import (`github_app_required`, ...). */
  const [importErrorCode, setImportErrorCode] = useState<string | null>(null);
  const [importedRepo, setImportedRepo] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Detect the return from GitHub's install page. Read from `window` rather
  // than `useSearchParams()` so the page does not need a Suspense boundary.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("github_app") === "connected") {
      setAwaitingInstall(true);
    }
  }, []);

  const loadRepositories = useCallback(async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) setIsLoadingRepos(true);
    setLoadError(null);
    try {
      const [ghRes, projRes] = await Promise.all([
        fetch("/api/github/repos", { cache: "no-store" }),
        fetch("/api/projects"),
      ]);

      const ghData = ghRes.ok ? await ghRes.json() : null;
      const projData = projRes.ok ? await projRes.json() : null;

      if (!isMountedRef.current) return;

      if (ghData) {
        setConnection({
          appConfigured: Boolean(ghData.app_configured),
          // Absent flag (older backend) is treated as "not gated" so a
          // deployment without the App keeps working.
          connected: ghData.github_app_connected !== false,
          connectUrl:
            typeof ghData.connect_url === "string"
              ? ghData.connect_url
              : "/api/github/install",
          // Absent flag (older backend) is assumed linked so a deployment that
          // predates the flag does not show a spurious sign-in prompt.
          githubIdentityLinked: ghData.github_identity_linked !== false,
        });
      }

      const projects: any[] = projData?.projects || [];
      const projectNames = new Set(
        projects.map((p: any) => String(p.repo_full_name).toLowerCase())
      );

      setConnected(
        projects.map((p: any) => ({
          repo_full_name: p.repo_full_name,
          default_branch: p.default_branch || "main",
          framework: p.settings?.framework || "nextjs",
          created_at: p.created_at,
        }))
      );

      const repos: AvailableRepo[] = (ghData?.repositories || []).map((item: any) => ({
        repo_full_name: item.repo_full_name,
        repo_name:
          item.repo_name || item.repo_full_name?.split("/")[1] || item.repo_full_name,
        default_branch: item.default_branch || "main",
        private: !!item.private,
        imported: projectNames.has(String(item.repo_full_name).toLowerCase()),
      }));

      setAvailable(repos);

      if (!ghRes.ok) {
        setLoadError(
          ghRes.status === 401
            ? "Your session expired. Sign in again to list repositories."
            : "Could not reach the GitHub App service. You can still enter a repository manually."
        );
      }
    } catch (err) {
      if (isMountedRef.current) {
        setLoadError("Could not load repositories. You can still enter one manually.");
      }
    } finally {
      if (isMountedRef.current && !options?.quiet) setIsLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  // After an install, ownership is recorded by the `installation.created`
  // webhook, which is asynchronous. Poll briefly so the user is not stuck on
  // the connect screen for the second or two the delivery takes.
  useEffect(() => {
    if (!awaitingInstall || connection?.connected) return;

    let cancelled = false;
    let attempts = 0;

    const timer = setInterval(async () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > 10) {
        // Give up rather than spin forever behind an unresponsive webhook. The
        // "I have already installed it" button remains as a manual retry.
        clearInterval(timer);
        setAwaitingInstall(false);
        return;
      }
      await loadRepositories({ quiet: true });
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [awaitingInstall, connection?.connected, loadRepositories]);

  const appConnectionRequired = Boolean(
    connection && connection.appConfigured && !connection.connected
  );

  const filteredAvailable = useMemo(() => {
    const query = repoSearch.trim().toLowerCase();
    return available.filter(
      (r) =>
        !r.imported &&
        (!query ||
          r.repo_name.toLowerCase().includes(query) ||
          r.repo_full_name.toLowerCase().includes(query))
    );
  }, [available, repoSearch]);

  const importedCount = available.filter((r) => r.imported).length + connected.length;
  const totalAvailable = available.length;

  const handleSelectRepo = (repo: AvailableRepo) => {
    setSelectedRepo(repo);
    setProjectName(repo.repo_name.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
    setSteps([]);
    setImportError(null);
    setImportErrorCode(null);
    setImportedRepo(null);
  };

  const handleSelectManual = (e: React.FormEvent) => {
    e.preventDefault();
    const value = manualRepo.trim();
    if (!value) return;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
      setLoadError("Enter the repository as owner/repository (for example acme/storefront).");
      return;
    }
    setLoadError(null);
    handleSelectRepo({
      repo_full_name: value,
      repo_name: value.split("/")[1] || value,
      default_branch: "main",
      private: false,
      imported: false,
    });
  };

  const handleAddEnvVar = () => {
    if (!envKey.trim()) return;
    setEnvVars([...envVars, { key: envKey.trim(), value: envValue }]);
    setEnvKey("");
    setEnvValue("");
  };

  const handleImport = async () => {
    if (!selectedRepo) return;
    setIsImporting(true);
    setSteps([]);
    setImportError(null);
    setImportErrorCode(null);
    setImportedRepo(null);

    const runStep = async (label: string, fn: () => Promise<void>) => {
      setSteps((prev) => [...prev, { label, state: "active" }]);
      try {
        await fn();
        setSteps((prev) =>
          prev.map((s, i) => (i === prev.length - 1 ? { ...s, state: "done" } : s))
        );
      } catch (err) {
        setSteps((prev) =>
          prev.map((s, i) => (i === prev.length - 1 ? { ...s, state: "failed" } : s))
        );
        throw err;
      }
    };

    try {
      await runStep("Verifying repository", async () => {
        if (!selectedRepo.repo_full_name.includes("/")) {
          throw new Error("Repository must be in 'owner/repository' form.");
        }
      });

      await runStep("Saving project configuration", async () => {
        const envRecord: Record<string, string> = {};
        envVars.forEach((ev) => {
          envRecord[ev.key] = ev.value;
        });

        // Build the personas map from the fields the user actually filled in.
        // An untouched persona is omitted entirely rather than stored as an
        // empty credential, which would show up as a configured role later.
        const roles: Record<string, { email: string; password?: string }> = {};
        if (userRoleEmail.trim() || userRolePassword) {
          roles.user = {
            email: userRoleEmail.trim(),
            ...(userRolePassword ? { password: userRolePassword } : {}),
          };
        }
        if (adminRoleEmail.trim() || adminRolePassword) {
          roles.admin = {
            email: adminRoleEmail.trim(),
            ...(adminRolePassword ? { password: adminRolePassword } : {}),
          };
        }

        const parsedPort = parseInt(previewPort, 10);
        const parsedSteps = parseInt(maxSteps, 10);
        const parsedWallTime = parseInt(wallTimeLimit, 10);
        const parsedCost = parseFloat(costLimit);

        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo_full_name: selectedRepo.repo_full_name,
            default_branch: selectedRepo.default_branch,
            settings: {
              name: projectName.trim() || selectedRepo.repo_name,
              root_directory: rootDirectory.trim() || "./",
              framework: preset.toLowerCase(),
              package_manager: "npm",
              build_command: buildCommand,
              install_command: installCommand,
              output_directory: outputDirectory,
              start_command: startCommand,
              port: Number.isFinite(parsedPort) ? parsedPort : 3000,
              scope: testScope,
              test_type: testType,
              enable_on_push: enableOnPush,
              enable_on_pr: enableOnPr,
              auto_repair: {
                enabled: autoRepairEnabled,
                trigger_mode: triggerMode,
                build_command: buildCommand,
                test_command: repairTestCommand,
                max_steps: Number.isFinite(parsedSteps) ? parsedSteps : 10,
                cost_limit_usd: Number.isFinite(parsedCost) ? parsedCost : 1.0,
                wall_time_limit_seconds: Number.isFinite(parsedWallTime) ? parsedWallTime : 180,
                custom_instructions: repairInstructions,
                env_vars: envRecord,
              },
              testing: {
                testing_instructions: testingInstructions,
                enable_login_flow: enableLoginFlow,
              },
              roles,
            },
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          // Carry the server's machine-readable code through so the UI can
          // offer the right next step ("Connect GitHub App") instead of a bare
          // error string.
          const failure = new Error(
            errorData.error || `Import failed (HTTP ${res.status}).`
          ) as Error & { code?: string };
          failure.code = errorData.code;
          throw failure;
        }

        // The credentials have been persisted server-side; do not keep copies in
        // component state for the rest of the session.
        setUserRolePassword("");
        setAdminRolePassword("");
      });

      await runStep("Refreshing your projects", async () => {
        if (selectedRepo) setActiveRepo(selectedRepo.repo_full_name);
        setImportedRepo(selectedRepo.repo_full_name);
        setAvailable((prev) =>
          prev.map((r) =>
            r.repo_full_name === selectedRepo.repo_full_name ? { ...r, imported: true } : r
          )
        );
        setConnected((prev) => [
          ...prev,
          {
            repo_full_name: selectedRepo.repo_full_name,
            default_branch: selectedRepo.default_branch,
            framework: preset.toLowerCase(),
            created_at: new Date().toISOString(),
          },
        ]);
        await refreshProjects();
      });

      // Import is not the destination — verifying is. Land on the project's own
      // workspace, where the first-run briefing asks how the first verification
      // should run and stays until a run has actually been dispatched.
      //
      // `firstRun=1` is an explicit "this project was just imported" signal. The
      // briefing normally also requires an authoritative empty run list, which
      // never arrives while the engine is unreachable — the exact moment a
      // promise to run the first verification matters most.
      router.push(
        `/dashboard/project?repo=${encodeURIComponent(selectedRepo.repo_full_name)}&firstRun=1`
      );
    } catch (err: any) {
      setImportError(err?.message || "Could not import this repository.");
      setImportErrorCode(typeof err?.code === "string" ? err.code : null);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-200">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 hover:text-slate-900 transition-colors font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </Link>
          <span>/</span>
          <span className="text-slate-900 font-semibold">Import Repository</span>
        </div>
      </div>

      {!selectedRepo ? (
        appConnectionRequired ? (
          /* VIEW A0: Import is gated. The deployment has a GitHub App but this
             account has not installed it / granted it access, so the picker is
             withheld rather than shown empty. The server enforces the same
             rule, so this screen is the only way forward. */
          <ConnectGitHubApp
            connectUrl={connection?.connectUrl || "/api/github/install"}
            githubIdentityLinked={connection?.githubIdentityLinked !== false}
            awaitingInstall={awaitingInstall}
            isChecking={isLoadingRepos}
            onRecheck={() => void loadRepositories()}
          />
        ) : (
        /* VIEW A: Import Repository */
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Import a repository
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              Repositories below are the ones your GitHub App can access. Importing is an explicit
              step — nothing becomes an RazeQA project until you choose it here.
            </p>
          </div>

          {/* Already connected projects */}
          {connected.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Connected projects</h2>
                <span className="text-[11px] font-mono text-slate-400">
                  {connected.length} imported
                </span>
              </div>
              <div className="space-y-1.5">
                {connected.map((p) => (
                  <div
                    key={p.repo_full_name}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50/60"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-900 font-mono truncate block">
                          {p.repo_full_name}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {p.framework} · {p.default_branch}
                        </span>
                      </div>
                    </div>
                    <Link
                      href="/dashboard/projects"
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900"
                    >
                      <Settings2 className="h-3 w-3" />
                      Manage
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Available repositories */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Available to import</h2>
              <span className="text-[11px] font-mono text-slate-400">
                {totalAvailable > 0
                  ? `${Math.max(totalAvailable - importedCount, 0)} of ${totalAvailable} available`
                  : "None detected"}
              </span>
            </div>

            {loadError && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{loadError}</span>
              </div>
            )}

            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search repositories..."
                className="w-full bg-slate-50 border border-slate-200 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
              />
            </div>

            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {isLoadingRepos ? (
                <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading repositories...</span>
                </div>
              ) : filteredAvailable.length > 0 ? (
                filteredAvailable.map((repo) => (
                  <div
                    key={repo.repo_full_name}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <GithubIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {repo.repo_name}
                        </span>
                        {repo.private ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 border border-slate-200 rounded px-1">
                            <Lock className="h-2.5 w-2.5" />
                            Private
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 border border-slate-200 rounded px-1">
                            <Globe className="h-2.5 w-2.5" />
                            Public
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="font-mono">{repo.repo_full_name}</span>
                        <span>•</span>
                        <span>{repo.default_branch}</span>
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
                  {available.length === 0 ? (
                    <>
                      <p className="font-medium text-slate-700">
                        No repositories available to this account.
                      </p>
                      <p className="text-[11px] text-slate-500">
                        The GitHub App is connected, but it has not been granted any
                        repositories yet. Grant it access to the repositories you want to
                        test, then reload this page.
                      </p>
                      <a
                        href={connection?.connectUrl || "/api/github/install"}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-900 underline"
                      >
                        Manage repository access on GitHub
                      </a>
                    </>
                  ) : (
                    <p>
                      {repoSearch
                        ? `No available repositories match "${repoSearch}".`
                        : "Every accessible repository has already been imported."}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Manual import fallback */}
            <form
              onSubmit={handleSelectManual}
              className="pt-3 border-t border-slate-100 space-y-2"
            >
              <label className="text-[11px] font-medium text-slate-600 block">
                Import a repository manually
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualRepo}
                  onChange={(e) => setManualRepo(e.target.value)}
                  placeholder="owner/repository"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!manualRepo.trim()}
                  className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs h-7 px-3 shrink-0"
                >
                  Continue
                </Button>
              </div>
              <p className="text-[10px] text-slate-400">
                Only repositories your GitHub App can access can be imported.
              </p>
            </form>
          </div>
        </div>
        )
      ) : (
        /* VIEW B: Configure & Import */
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6 shadow-sm">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Configure project</h1>
              <p className="text-xs text-slate-500 mt-1">
                These settings are saved when you import the repository and take effect on the
                first run. Everything remains editable afterwards under Project Settings.
              </p>
            </div>

            {/* Importing from GitHub Banner */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2.5 min-w-0">
                <GitBranch className="h-4 w-4 text-slate-700 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] font-mono text-slate-500 block">
                    Importing repository
                  </span>
                  <span className="text-xs font-semibold text-slate-900 font-mono truncate block">
                    {selectedRepo.repo_full_name}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono bg-white text-slate-700 border border-slate-200 px-2 py-0.5 rounded">
                {selectedRepo.default_branch}
              </span>
            </div>

            {/* Form Fields */}
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1.5">
                    RazeQA Workspace
                  </label>
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-slate-900">
                    <span className="truncate">
                      {userEmail ? userEmail.split("@")[0] : "workspace"}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 px-1 rounded">
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

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1.5">
                  Root Directory
                </label>
                <input
                  type="text"
                  value={rootDirectory}
                  onChange={(e) => setRootDirectory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-slate-900 font-mono"
                />
              </div>

              {/* Accordion: Build and Output Settings */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsBuildSettingsOpen(!isBuildSettingsOpen)}
                  className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="font-medium text-slate-900">Build and Output Settings</span>
                  {isBuildSettingsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
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
                      <label className="text-[10px] text-slate-500 block mb-1">
                        Output Directory
                      </label>
                      <input
                        type="text"
                        value={outputDirectory}
                        onChange={(e) => setOutputDirectory(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">
                        Install Command
                      </label>
                      <input
                        type="text"
                        value={installCommand}
                        onChange={(e) => setInstallCommand(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">
                          Start Command
                        </label>
                        <input
                          type="text"
                          value={startCommand}
                          onChange={(e) => setStartCommand(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">
                          Target Preview Port
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={previewPort}
                          onChange={(e) => setPreviewPort(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Accordion: Testing Policy (scope, type, AI instructions, login flow) */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsTestingPolicyOpen(!isTestingPolicyOpen)}
                  className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="font-medium text-slate-900 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                    Testing Policy &amp; AI Instructions
                  </span>
                  {isTestingPolicyOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {isTestingPolicyOpen && (
                  <div className="p-3 bg-white border-t border-slate-200 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">
                          Default Test Scope
                        </label>
                        <select
                          value={testScope}
                          onChange={(e) => setTestScope(e.target.value as "changed" | "full")}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 cursor-pointer"
                        >
                          <option value="changed">Changed (diff-adjacent journeys)</option>
                          <option value="full">Full (entire regression sweep)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">
                          Default Test Type
                        </label>
                        <select
                          value={testType}
                          onChange={(e) =>
                            setTestType(
                              e.target.value as "functional" | "functional + visual"
                            )
                          }
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 cursor-pointer"
                        >
                          <option value="functional">Functional only</option>
                          <option value="functional + visual">Functional + visual defects</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">
                        AI Testing Instructions
                      </label>
                      <textarea
                        rows={5}
                        value={testingInstructions}
                        onChange={(e) => setTestingInstructions(e.target.value)}
                        placeholder={
                          "Guide the agent's journeys in plain language, for example:\n" +
                          "- Always verify checkout with a guest user before a signed-in one\n" +
                          "- Treat the /admin section as out of scope\n" +
                          "- The pricing page has an intentional A/B test on the hero CTA"
                        }
                        className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white resize-y"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Saved as <code className="font-mono">settings.testing.testing_instructions</code>{" "}
                        and passed to the testing agent on every run.
                      </p>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableLoginFlow}
                        onChange={(e) => setEnableLoginFlow(e.target.checked)}
                        className="h-3.5 w-3.5 cursor-pointer"
                      />
                      <span>Enable authenticated login-flow journeys</span>
                    </label>

                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Trigger policy
                      </span>
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableOnPr}
                          onChange={(e) => setEnableOnPr(e.target.checked)}
                          className="h-3.5 w-3.5 cursor-pointer"
                        />
                        <span className="flex items-center gap-1.5">
                          <Zap className="h-3 w-3 text-amber-500" />
                          Run verification on pull requests
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableOnPush}
                          onChange={(e) => setEnableOnPush(e.target.checked)}
                          className="h-3.5 w-3.5 cursor-pointer"
                        />
                        <span className="flex items-center gap-1.5">
                          <Zap className="h-3 w-3 text-amber-500" />
                          Run verification on pushes to the default branch
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Accordion: Test Personas */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsPersonasOpen(!isPersonasOpen)}
                  className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="font-medium text-slate-900 flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-indigo-600" />
                    Test Personas (Credentials)
                  </span>
                  {isPersonasOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {isPersonasOpen && (
                  <div className="p-3 bg-white border-t border-slate-200 space-y-4">
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Credentials are encrypted at rest and injected into the preview sandbox
                      only at boot time. Leave a persona blank to configure it later.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2 rounded-md border border-slate-200 p-2.5">
                        <span className="text-[11px] font-semibold text-slate-800">User</span>
                        <input
                          type="text"
                          value={userRoleEmail}
                          onChange={(e) => setUserRoleEmail(e.target.value)}
                          placeholder="user@example.com"
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900"
                        />
                        <input
                          type="password"
                          value={userRolePassword}
                          onChange={(e) => setUserRolePassword(e.target.value)}
                          placeholder="Password"
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900"
                        />
                      </div>
                      <div className="space-y-2 rounded-md border border-slate-200 p-2.5">
                        <span className="text-[11px] font-semibold text-slate-800">Admin</span>
                        <input
                          type="text"
                          value={adminRoleEmail}
                          onChange={(e) => setAdminRoleEmail(e.target.value)}
                          placeholder="admin@example.com"
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900"
                        />
                        <input
                          type="password"
                          value={adminRolePassword}
                          onChange={(e) => setAdminRolePassword(e.target.value)}
                          placeholder="Password"
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Accordion: Autonomous Repair */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsAutoRepairOpen(!isAutoRepairOpen)}
                  className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <span className="font-medium text-slate-900 flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-indigo-600" />
                    Autonomous Repair
                  </span>
                  {isAutoRepairOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {isAutoRepairOpen && (
                  <div className="p-3 bg-white border-t border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        Let the agent propose fixes for regressions
                      </span>
                      <input
                        type="checkbox"
                        checked={autoRepairEnabled}
                        onChange={(e) => setAutoRepairEnabled(e.target.checked)}
                        className="h-3.5 w-3.5 cursor-pointer"
                      />
                    </div>

                    {autoRepairEnabled && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">
                              Approval Mode
                            </label>
                            <select
                              value={triggerMode}
                              onChange={(e) =>
                                setTriggerMode(
                                  e.target.value as "automatic" | "manual_approval"
                                )
                              }
                              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 cursor-pointer"
                            >
                              <option value="automatic">Automatic</option>
                              <option value="manual_approval">Manual approval</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">
                              Test Command
                            </label>
                            <input
                              type="text"
                              value={repairTestCommand}
                              onChange={(e) => setRepairTestCommand(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">
                              Max Steps
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={maxSteps}
                              onChange={(e) => setMaxSteps(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">
                              Cost Limit (USD)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.1"
                              value={costLimit}
                              onChange={(e) => setCostLimit(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">
                              Wall Time (s)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={wallTimeLimit}
                              onChange={(e) => setWallTimeLimit(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">
                            AI Repair Instructions
                          </label>
                          <textarea
                            rows={3}
                            value={repairInstructions}
                            onChange={(e) => setRepairInstructions(e.target.value)}
                            placeholder="Constraints for the repair agent, e.g. never touch generated migrations, prefer minimal diffs..."
                            className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white resize-y"
                          />
                        </div>
                      </>
                    )}
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
                  {isEnvVarsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
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
                          <div
                            key={i}
                            className="flex items-center justify-between px-2 py-1 bg-slate-100 rounded text-[11px] font-mono"
                          >
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

            {/* Import progress: only real steps, only after they run */}
            {steps.length > 0 && (
              <div className="space-y-1.5">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {step.state === "done" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : step.state === "failed" ? (
                      <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 text-slate-400 animate-spin shrink-0" />
                    )}
                    <span
                      className={
                        step.state === "failed"
                          ? "text-red-700"
                          : step.state === "done"
                          ? "text-slate-700"
                          : "text-slate-500"
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Error message. A gated import gets the connect action inline
                rather than a dead end. */}
            {importError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium">Import failed</p>
                  <p>{importError}</p>
                  {importErrorCode === "github_app_required" && (
                    <a
                      href={connection?.connectUrl || "/api/github/install"}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                    >
                      <GithubIcon className="h-3.5 w-3.5" />
                      Connect GitHub App
                      <ArrowRight className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Success */}
            {importedRepo && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    <span className="font-semibold">{importedRepo}</span> is now an RazeQA project.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      router.push(
                        `/dashboard/project?repo=${encodeURIComponent(importedRepo)}&firstRun=1`
                      )
                    }
                    className="border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100 text-xs h-7 px-3"
                  >
                    Open project
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => router.push("/dashboard")}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 text-xs h-7 px-3"
                  >
                    Dashboard
                  </Button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedRepo(null);
                  setSteps([]);
                  setImportError(null);
                  setImportErrorCode(null);
                  setImportedRepo(null);
                }}
                disabled={isImporting}
                className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs h-10 px-4"
              >
                Back
              </Button>
              <Button
                disabled={isImporting || !!importedRepo}
                onClick={handleImport}
                className="flex-1 bg-slate-900 text-white hover:bg-slate-800 font-semibold text-xs py-2.5 rounded-md cursor-pointer transition-all shadow-sm active:scale-[0.99]"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : importedRepo ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-2" />
                    Imported
                  </>
                ) : (
                  <>
                    Import repository
                    <ArrowRight className="h-3.5 w-3.5 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
