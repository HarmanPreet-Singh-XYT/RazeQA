"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Home,
  Layers,
  Terminal,
  BarChart3,
  Activity,
  Eye,
  Shield,
  Globe,
  Sliders,
  Link as LinkIcon,
  GitBranch,
  Blocks,
  Database,
  Flag,
  Sparkles,
  Cpu,
  Box,
  Workflow,
  Compass,
  LayoutGrid,
  Play,
  Settings,
  ChevronDown,
  Plus,
  Search,
  Bell,
  MoreHorizontal,
  LogOut,
  ExternalLink,
  Check,
  X,
  Menu,
  ArrowUpRight,
  HelpCircle,
  ArrowLeft,
  FolderGit2,
  GitPullRequest,
  KeyRound,
  ListChecks,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { useDashboard } from "./dashboard-context";
import { CommandPalette } from "./command-palette";
import { ExternalTestModal } from "./external-test-modal";

export function DashboardNav({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams ? searchParams.get("tab") : null;
  const urlRepoParam = searchParams ? searchParams.get("repo") : null;
  const {
    userEmail,
    activeRepo,
    setActiveRepo,
    gitSha,
    engineConnected,
    projects,
  } = useDashboard();

  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAddNewOpen, setIsAddNewOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isExternalTestOpen, setIsExternalTestOpen] = useState(false);

  // Global hotkey 'F' or 'Cmd+K' to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "f" || e.key === "F") &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // The `repo` query param is authoritative for the page being viewed. The
  // context value can lag a render behind when /dashboard/project?repo=… is
  // opened directly (refresh, import redirect) or before the project list
  // resolves. Reading only `activeRepo` there made "Test Runs" fall back to the
  // fleet-wide list instead of the project the user was looking at.
  const scopeRepo = urlRepoParam || activeRepo || projects[0]?.repo_full_name || "";

  const projectName = scopeRepo
    ? scopeRepo.split("/")[1] || scopeRepo
    : (projects[0]?.name || "Workspace");

  // Breadcrumb title resolution
  const getBreadcrumbTitle = () => {
    if (pathname === "/dashboard") return "Copilot";
    if (pathname.startsWith("/dashboard/overview")) return "Overview";
    if (pathname.startsWith("/dashboard/projects")) {
      if (currentTab === "roles") return "Test Personas";
      if (currentTab === "auto-repair") return "AI Auto-Repair";
      if (currentTab === "env-vars") return "Sandbox Secrets";
      return "Project Settings";
    }
    if (pathname === "/dashboard/project") return "Project Overview";
    if (pathname.startsWith("/dashboard/runs") || pathname.startsWith("/dashboard/deployments")) return "Test Runs";
    if (pathname.startsWith("/dashboard/agent")) return "AI Copilot";
    if (pathname.startsWith("/dashboard/tools") || pathname.startsWith("/dashboard/journeys")) return "User Journeys";
    if (pathname.startsWith("/dashboard/logs")) return "Execution Logs";
    if (pathname.startsWith("/dashboard/analytics")) return "Quality Analytics";
    if (pathname.startsWith("/dashboard/new")) return "Import Repository";
    return "Dashboard";
  };

  const isExternalActive = Boolean(scopeRepo.startsWith("external:"));

  const isNavActive = (href: string) => {
    const [itemBase] = href.split("?");
    if (itemBase === "/dashboard") return pathname === "/dashboard";
    if (itemBase === "/dashboard/project") return pathname === "/dashboard/project";
    if (itemBase === "/dashboard/projects") {
      return pathname === "/dashboard/projects" && !currentTab;
    }
    return pathname.startsWith(itemBase);
  };

  const isSecondaryActive = (href: string) => {
    if (href.startsWith("#")) return false;
    const [basePath, queryStr] = href.split("?");
    if (pathname !== basePath) return false;
    if (!queryStr) return !currentTab;
    const params = new URLSearchParams(queryStr);
    const targetTab = params.get("tab");
    return currentTab === targetTab;
  };

  // Pages that are intentionally fleet-wide: they carry no project in the URL
  // and must not inherit the persisted active project.
  const isOverviewPage =
    !urlRepoParam &&
    (pathname === "/dashboard/overview" ||
      // The copilot home is an ordinary dashboard tab: it keeps the same header
      // and tab strip, and only drops into the project shell when a repo is in
      // the URL (the project-scoped copilot).
      pathname === "/dashboard" ||
      pathname === "/dashboard/runs" ||
      pathname === "/dashboard/tools" ||
      pathname === "/dashboard/journeys" ||
      pathname === "/dashboard/logs" ||
      pathname === "/dashboard/analytics");

  // Every project-level destination keeps the active project in view; only the
  // overview pages above are intentionally fleet-wide.
  const scopeQuery = scopeRepo ? `?repo=${encodeURIComponent(scopeRepo)}` : "";

  // The copilot is a full page, and it follows the page's scope. A project page
  // opens it on that project; an overview page opens the *workspace* copilot,
  // which the web layer scopes to the caller's own projects.
  const agentHref = isOverviewPage ? "/dashboard" : `/dashboard${scopeQuery}`;

  const navPrimary = [
    {
      href: `/dashboard/project${scopeQuery}`,
      label: "Overview",
      icon: Home,
    },
    {
      href: `/dashboard/pull-requests${scopeQuery}`,
      label: "Pull Requests",
      icon: GitPullRequest,
    },
    {
      href: `/dashboard/tests${scopeQuery}`,
      label: "Tests",
      icon: ListChecks,
    },
    {
      href: `/dashboard/runs${scopeQuery}`,
      label: "Test Runs",
      icon: Layers,
    },
    {
      href: `/dashboard/tools${scopeQuery}`,
      label: "User Journeys",
      icon: Compass,
    },
    {
      href: `/dashboard/logs${scopeQuery}`,
      label: "Execution Logs",
      icon: Terminal,
    },
    {
      href: `/dashboard/analytics${scopeQuery}`,
      label: "Quality Analytics",
      icon: BarChart3,
    },
    {
      href: `/dashboard/projects${scopeQuery}`,
      label: "Settings",
      icon: Settings,
    },
  ];

  const navSecondary = [
    ...(!isExternalActive
      ? [
          { href: "/dashboard/projects?tab=roles", label: "Test Personas", icon: Shield },
          { href: "/dashboard/projects?tab=auto-repair", label: "AI Auto-Repair", icon: Sparkles },
          { href: "/dashboard/projects?tab=env-vars", label: "Sandbox Secrets", icon: Sliders },
          { href: "/dashboard/context", label: "Context & Secrets", icon: KeyRound },
          { href: "/dashboard/automation", label: "Automation", icon: Workflow },
          { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
        ]
      : []),
    { href: `/dashboard${scopeQuery}`, label: "Copilot", icon: Cpu },
  ];

  if (isOverviewPage) {
    return (
      <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans antialiased selection:bg-slate-200 flex flex-col w-full">
        {/* Light Grid Background */}
        <div className="pointer-events-none fixed inset-0 bg-grid-light mask-radial-light opacity-60 z-0" />

        {/* Global Workspace Header (Vercel Style) */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md w-full">
          {/* Top Row: Brand + Team Switcher + Right Action Buttons */}
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center gap-2 text-slate-900 shrink-0">
                <div className="h-6 w-6 rounded bg-slate-950 text-white flex items-center justify-center font-bold text-[11px] font-mono shadow-2xs">
                  QA
                </div>
              </Link>
              <span className="text-slate-300 select-none">/</span>
              <div className="relative">
                <button
                  onClick={() => setIsTeamDropdownOpen(!isTeamDropdownOpen)}
                  className="flex items-center gap-2 px-2 py-1 rounded-md text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <div className="h-5 w-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                    {userEmail ? userEmail.slice(0, 1).toUpperCase() : "H"}
                  </div>
                  <span>{userEmail ? userEmail.split("@")[0] : "harmanpreet-singh"}</span>
                  <span className="text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded shrink-0">
                    AutoQA
                  </span>
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>

                {isTeamDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsTeamDropdownOpen(false)} />
                    <div className="absolute left-0 top-9 z-50 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl space-y-1 text-xs">
                      <div className="px-2 py-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                        Workspace
                      </div>
                      <div className="px-2 py-1.5 rounded bg-slate-100 font-semibold text-slate-900 flex items-center justify-between">
                        <span>{userEmail || "harmanpreet-singh"}</span>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right Action Buttons */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setIsCommandPaletteOpen(true)}
                className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 text-xs transition-colors cursor-pointer"
              >
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <span>Search</span>
                <kbd className="font-mono text-[10px] bg-white border border-slate-200 text-slate-500 px-1 rounded">F</kbd>
              </button>

              <Link
                href={agentHref}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
              >
                <Cpu className="h-3.5 w-3.5 text-slate-600" />
                <span>Agent</span>
              </Link>

              <div className="relative">
                <button
                  onClick={() => setIsAddNewOpen(!isAddNewOpen)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-950 text-white hover:bg-slate-800 text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
                >
                  <span>Add New</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {isAddNewOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsAddNewOpen(false)} />
                    <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl space-y-1 text-xs">
                      <Link
                        href="/dashboard/new"
                        onClick={() => setIsAddNewOpen(false)}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded text-slate-700 hover:text-slate-950 hover:bg-slate-50"
                      >
                        <FolderGit2 className="h-4 w-4 text-slate-500" />
                        <span>Import Git Repository</span>
                      </Link>
                      <button
                        onClick={() => {
                          setIsAddNewOpen(false);
                          setIsExternalTestOpen(true);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-slate-700 hover:text-slate-950 hover:bg-slate-50 text-left cursor-pointer"
                      >
                        <Globe className="h-4 w-4 text-sky-600" />
                        <span>Verify External Site</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* User Avatar Menu */}
              <div className="relative">
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="h-7 w-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold font-mono cursor-pointer"
                >
                  {userEmail ? userEmail.slice(0, 2).toUpperCase() : "HP"}
                </button>
                {isUserMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                    <div className="absolute right-0 top-9 z-50 w-52 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl space-y-1 text-xs">
                      <div className="px-2 py-1 text-[11px] text-slate-500 font-mono truncate">{userEmail}</div>
                      <div className="border-t border-slate-100 my-1" />
                      <button
                        onClick={async () => {
                          await logout();
                          window.location.href = "/login";
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-rose-600 hover:bg-rose-50 cursor-pointer text-left"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Vercel-style Top Tabs Strip */}
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 flex items-center gap-1 overflow-x-auto text-xs font-medium text-slate-600 no-scrollbar">
            <Link
              href="/dashboard"
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                pathname === "/dashboard"
                  ? "border-slate-950 text-slate-950 font-bold"
                  : "border-transparent hover:text-slate-950 hover:border-slate-300"
              }`}
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>Copilot</span>
            </Link>
            <Link
              href="/dashboard/overview"
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                pathname.startsWith("/dashboard/overview")
                  ? "border-slate-950 text-slate-950 font-bold"
                  : "border-transparent hover:text-slate-950 hover:border-slate-300"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Projects</span>
            </Link>
            <Link
              href="/dashboard/runs"
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                pathname.startsWith("/dashboard/runs")
                  ? "border-slate-950 text-slate-950 font-bold"
                  : "border-transparent hover:text-slate-950 hover:border-slate-300"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Activity &amp; Runs</span>
            </Link>
            <Link
              href="/dashboard/tools"
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                pathname.startsWith("/dashboard/tools") || pathname.startsWith("/dashboard/journeys")
                  ? "border-slate-950 text-slate-950 font-bold"
                  : "border-transparent hover:text-slate-950 hover:border-slate-300"
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>User Journeys</span>
            </Link>
            <Link
              href="/dashboard/logs"
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                pathname.startsWith("/dashboard/logs")
                  ? "border-slate-950 text-slate-950 font-bold"
                  : "border-transparent hover:text-slate-950 hover:border-slate-300"
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Execution Logs</span>
            </Link>
            <Link
              href="/dashboard/analytics"
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                pathname.startsWith("/dashboard/analytics")
                  ? "border-slate-950 text-slate-950 font-bold"
                  : "border-transparent hover:text-slate-950 hover:border-slate-300"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Quality Analytics</span>
            </Link>
          </div>
        </header>

        {/* Full-width content */}
        <main className="relative z-10 flex-1 w-full bg-transparent">
          {children}
        </main>

        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onOpenAgent={() => router.push(agentHref)}
          onOpenExternalTest={() => setIsExternalTestOpen(true)}
        />
        <ExternalTestModal
          isOpen={isExternalTestOpen}
          onClose={() => setIsExternalTestOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans antialiased selection:bg-slate-200 flex flex-col lg:flex-row w-full">
      {/* Light Grid Background */}
      <div className="pointer-events-none fixed inset-0 bg-grid-light mask-radial-light opacity-60 z-0" />

      {/* =========================================================================
          LEFT SIDEBAR (Light Modern Sidebar for Project Context)
          ========================================================================= */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white text-slate-900 h-screen sticky top-0 z-30 select-none">
        {/* Top: Back to All Projects + Active Project Card */}
        <div className="p-3 border-b border-slate-200">
          <Link
            href="/dashboard/overview"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition-colors group mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-900" />
            <span>All Projects</span>
          </Link>

          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2 min-w-0">
              {isExternalActive ? (
                <Globe className="h-4 w-4 text-sky-600 shrink-0" />
              ) : (
                <FolderGit2 className="h-4 w-4 text-slate-700 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate">
                  {projectName}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {isExternalActive ? "External Website" : "Git Repository"}
                </div>
              </div>
            </div>
          </div>
        </div>

          {/* Team Dropdown */}
          {isTeamDropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsTeamDropdownOpen(false)} />
              <div className="absolute left-3 right-3 top-13 z-50 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl space-y-1 text-xs">
                <div className="px-2 py-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                  Teams &amp; Scope
                </div>
                <button
                  onClick={() => setIsTeamDropdownOpen(false)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-slate-100 text-slate-900 text-left font-medium"
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="h-4 w-4 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center font-bold">
                      H
                    </div>
                    <span className="truncate">{userEmail || "harmanpreet-singh-xyt"}</span>
                  </div>
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                </button>
                <div className="border-t border-slate-100 my-1" />
                <Link
                  href="/dashboard/new"
                  onClick={() => setIsTeamDropdownOpen(false)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Team</span>
                </Link>
              </div>
            </>
          )}

        {/* Find Search Input */}
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-100 transition-colors text-xs group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-900" />
              <span>Find</span>
            </div>
            <kbd className="font-mono text-[10px] bg-white border border-slate-200 text-slate-500 px-1 py-0.2 rounded shadow-2xs">
              F
            </kbd>
          </button>
        </div>

        {/* Scrollable Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 text-xs">
          {navPrimary.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors ${
                  active
                    ? "bg-slate-100 text-slate-950 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-slate-950" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div className="border-t border-slate-200 my-2 pt-2" />

          {navSecondary.map((item) => {
            const Icon = item.icon;
            const active = isSecondaryActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors ${
                  active
                    ? "bg-slate-100 text-slate-950 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-slate-950" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer: User profile & Notification */}
        <div className="p-2 border-t border-slate-200 bg-white relative">
          <div className="flex items-center justify-between p-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 border border-slate-300 flex items-center justify-center text-[10px] font-mono text-slate-800 shrink-0 font-bold">
                {userEmail ? userEmail.slice(0, 2).toUpperCase() : "HP"}
              </div>
              <span className="text-xs text-slate-600 truncate font-medium">
                {userEmail ? userEmail.split("@")[0] : "harmanpreet-singh"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={agentHref}
                title="AutoQA Copilot"
                className="relative p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
              >
                <Bell className="h-3.5 w-3.5" />
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-sky-500" />
              </Link>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {isUserMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
              <div className="absolute left-2 right-2 bottom-12 z-50 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl text-xs space-y-1">
                <div className="px-2 py-1 text-[10px] text-slate-400 truncate font-mono">
                  {userEmail || "harmanpreet-singh-xyt"}
                </div>
                <Link
                  href="/dashboard/overview"
                  onClick={() => setIsUserMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  <Home className="h-3.5 w-3.5" />
                  <span>All Projects</span>
                </Link>
                <Link
                  href="/dashboard/tools"
                  onClick={() => setIsUserMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>Security &amp; API Keys</span>
                </Link>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={() => logout()}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-rose-600 hover:bg-rose-50 text-left"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log out</span>
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Dynamic Viewport Content Column (Header + Children) */}
      <div className="flex-1 flex flex-col min-w-0 bg-transparent">
        {/* =========================================================================
            TOP HEADER BAR (Light Breadcrumb & Action Header)
            ========================================================================= */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-md w-full">
          <div className="flex items-center justify-between px-4 sm:px-6 py-2.5">
            {/* Left: Mobile Toggle + QA Logo + Project Switcher + Breadcrumb */}
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile hamburger */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
              >
                {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>

              {/* AutoQA Logo Icon */}
              <Link href="/dashboard" className="flex items-center gap-2 text-slate-900 shrink-0">
                <div className="h-6 w-6 rounded bg-slate-950 text-white flex items-center justify-center font-bold text-[11px] font-mono shadow-2xs">
                  QA
                </div>
              </Link>

              <span className="text-slate-300 hidden sm:inline select-none">/</span>

              {/* Project Switcher Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all cursor-pointer truncate max-w-[180px] sm:max-w-[260px]"
                >
                  <span className="truncate">{pathname === "/dashboard/overview" ? "All Projects" : projectName}</span>
                  <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
                </button>

                {isRepoDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsRepoDropdownOpen(false)} />
                    <div className="absolute left-0 top-9 z-50 w-72 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl space-y-1 text-xs">
                      <div className="px-2 py-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                        Switch Project
                      </div>
                      {projects.map((p) => {
                        const isCurrent = scopeRepo === p.repo_full_name && pathname !== "/dashboard/overview";
                        return (
                          <button
                            key={p.repo_full_name}
                            onClick={() => {
                              setActiveRepo(p.repo_full_name);
                              setIsRepoDropdownOpen(false);
                              router.push(`/dashboard/project?repo=${encodeURIComponent(p.repo_full_name)}`);
                            }}
                            className={`w-full flex items-center justify-between px-2 py-1.5 rounded transition-colors text-left ${
                              isCurrent
                                ? "bg-slate-100 text-slate-950 font-semibold"
                                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-[10px] font-mono text-indigo-600">●</span>
                              <span className="truncate">{p.name || p.repo_full_name.split("/")[1] || p.repo_full_name}</span>
                            </div>
                            {isCurrent && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                          </button>
                        );
                      })}
                      <div className="border-t border-slate-100 my-1" />
                      <Link
                        href="/dashboard/overview"
                        onClick={() => setIsRepoDropdownOpen(false)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded transition-colors ${
                          pathname === "/dashboard/overview"
                            ? "bg-slate-100 text-slate-950 font-semibold"
                            : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Home className="h-3.5 w-3.5" />
                          <span>View All Projects</span>
                        </div>
                        {pathname === "/dashboard/overview" && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                      </Link>
                      <Link
                        href="/dashboard/new"
                        onClick={() => setIsRepoDropdownOpen(false)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-slate-900 bg-slate-100 hover:bg-slate-200 font-medium"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Import New Project</span>
                      </Link>
                    </div>
                  </>
                )}
              </div>

              {pathname !== "/dashboard" && (
                <>
                  <span className="text-slate-300 select-none">/</span>
                  <span className="text-xs font-semibold text-slate-500 inline truncate">
                    {getBreadcrumbTitle()}
                  </span>
                </>
              )}
            </div>

            {/* Right Action Buttons */}
            <div className="flex items-center gap-2.5">
              {/* Autonomous Agent Button */}
              <Link
                href={agentHref}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold transition-all shadow-2xs cursor-pointer group"
              >
                <Cpu className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-900 transition-colors" />
                <span>Agent</span>
              </Link>

              {/* Add New Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsAddNewOpen(!isAddNewOpen)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-950 text-white hover:bg-slate-800 text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
                >
                  <span>Add New</span>
                  <ChevronDown className="h-3 w-3" />
                </button>

                {isAddNewOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsAddNewOpen(false)} />
                    <div className="absolute right-0 top-8 z-50 w-52 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl text-xs space-y-1">
                      <Link
                        href="/dashboard/new"
                        onClick={() => setIsAddNewOpen(false)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded text-slate-800 hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5 text-slate-500" />
                        <div>
                          <span className="font-semibold block text-slate-900">Project</span>
                          <span className="text-[10px] text-slate-500">Import Git repository</span>
                        </div>
                      </Link>
                      <button
                        onClick={() => {
                          setIsAddNewOpen(false);
                          setIsExternalTestOpen(true);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-slate-800 hover:bg-slate-50 text-left"
                      >
                        <Globe className="h-3.5 w-3.5 text-sky-600" />
                        <div>
                          <span className="font-semibold block text-slate-900">External Site Test</span>
                          <span className="text-[10px] text-slate-500">Verify live website URL</span>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Help / Feedback */}
              <Link
                href={
                  scopeRepo && !scopeRepo.startsWith("external:")
                    ? `https://github.com/${scopeRepo}`
                    : projects[0]?.repo_full_name && !projects[0].repo_full_name.startsWith("external:")
                    ? `https://github.com/${projects[0].repo_full_name}`
                    : "https://github.com"
                }
                target="_blank"
                title="GitHub Repo"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors hidden sm:inline-flex"
              >
                <HelpCircle className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </header>

        {/* Dynamic Main Viewport Content */}
        <main className="flex-1 w-full min-w-0">
          {children}
        </main>
      </div>

      {/* =========================================================================
          MOBILE DRAWER SIDEBAR
          ========================================================================= */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-slate-900/50 backdrop-blur-xs">
          <div className="fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-200 p-4 flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded bg-slate-950 text-white flex items-center justify-center font-mono font-bold text-xs">
                    QA
                  </div>
                  <span className="font-bold text-sm text-slate-950">AutoQA</span>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav className="space-y-1 text-xs">
                {navPrimary.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-md ${
                        active
                          ? "bg-slate-100 text-slate-950 font-semibold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

                <div className="border-t border-slate-200 my-2 pt-2" />

                {navSecondary.map((item) => {
                  const Icon = item.icon;
                  const active = isSecondaryActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-md ${
                        active
                          ? "bg-slate-100 text-slate-950 font-semibold"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <button
                onClick={() => logout()}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-rose-600 hover:bg-rose-50 text-xs font-semibold"
              >
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenAgent={() => router.push(agentHref)}
        onOpenExternalTest={() => setIsExternalTestOpen(true)}
      />

      <ExternalTestModal
        isOpen={isExternalTestOpen}
        onClose={() => setIsExternalTestOpen(false)}
      />
    </div>
  );
}
