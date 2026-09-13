"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  Layers,
  LayoutDashboard,
  Terminal,
  BarChart3,
  Eye,
  Plus,
  GitBranch,
  Settings,
  Sparkles,
  ArrowRight,
  Globe,
  Cpu,
} from "lucide-react";
import { useDashboard } from "./dashboard-context";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAgent: () => void;
  onOpenExternalTest: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onOpenAgent,
  onOpenExternalTest,
}: CommandPaletteProps) {
  const router = useRouter();
  const { projects, setActiveRepo, activeRepo } = useDashboard();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const allProjects = projects.map((p) => ({
    name: p.repo_full_name.split("/")[1] || p.repo_full_name,
    repo: p.repo_full_name,
    desc: "Connected GitHub Repository",
  }));

  // Commands should land in the project the user is already working in, not on
  // the fleet-wide view — the sidebar does the same. The overview page keeps
  // meaning "all projects"; every project-level page carries the scope.
  const scopeQuery = activeRepo ? `?repo=${encodeURIComponent(activeRepo)}` : "";

  const navigationItems = [
    {
      label: "Overview",
      icon: LayoutDashboard,
      href: activeRepo ? `/dashboard/project${scopeQuery}` : "/dashboard",
      desc: "Project deployment showcase & active branches",
    },
    { label: "Test Runs", icon: Layers, href: `/dashboard/runs${scopeQuery}`, desc: "Verification runs, test steps & proofs" },
    { label: "Execution Logs", icon: Terminal, href: `/dashboard/logs${scopeQuery}`, desc: "Real-time streaming console & request logs" },
    { label: "User Journeys", icon: Globe, href: `/dashboard/tools${scopeQuery}`, desc: "Interactive synthetic test flows" },
    { label: "Quality Analytics", icon: BarChart3, href: `/dashboard/analytics${scopeQuery}`, desc: "Fleet test pass rates & flakiness" },
    { label: "Import Repository", icon: Plus, href: "/dashboard/new", desc: "Import repository & configure deployment" },
    { label: "Project Settings", icon: Settings, href: `/dashboard/projects${scopeQuery}`, desc: "Fleet overview of all repositories" },
  ];

  const filteredNav = navigationItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()) ||
    item.desc.toLowerCase().includes(query.toLowerCase())
  );

  const filteredProjects = allProjects.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.repo.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b border-slate-200 gap-3">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, runs, pages, or commands..."
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-[10px] font-mono text-slate-500 border border-slate-200 bg-slate-50 px-1.5 py-0.5 rounded">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-2 space-y-4">
          {/* Quick Actions */}
          <div>
            <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase px-2 mb-1 block">
              Quick Actions
            </span>
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  onClose();
                  onOpenAgent();
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-md text-slate-800 hover:bg-slate-100 hover:text-slate-950 transition-colors group cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Cpu className="h-4 w-4 text-slate-700" />
                  <div>
                    <span className="font-semibold">Open Autonomous Agent</span>
                    <span className="text-[11px] text-slate-500 block">Autonomous verification, sandboxed runner, and Playwright forensics</span>
                  </div>
                </div>
                <ArrowRight className="h-3 w-3 text-slate-400 group-hover:text-slate-900" />
              </button>

              <button
                onClick={() => {
                  onClose();
                  onOpenExternalTest();
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-md text-slate-800 hover:bg-sky-50 hover:text-sky-950 transition-colors group cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Globe className="h-4 w-4 text-sky-600" />
                  <div>
                    <span className="font-semibold">Test External Website URL</span>
                    <span className="text-[11px] text-slate-500 block">Run live synthetic Playwright journey against any URL</span>
                  </div>
                </div>
                <ArrowRight className="h-3 w-3 text-slate-400 group-hover:text-sky-700" />
              </button>
            </div>
          </div>

          {/* Navigation Pages */}
          {filteredNav.length > 0 && (
            <div>
              <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase px-2 mb-1 block">
                Pages &amp; Views
              </span>
              <div className="space-y-0.5">
                {filteredNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      onClick={() => {
                        onClose();
                        router.push(item.href);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-md text-slate-800 hover:bg-slate-100 hover:text-slate-950 transition-colors group cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-slate-400 group-hover:text-slate-900" />
                        <div>
                          <span className="font-medium text-slate-900">{item.label}</span>
                          <span className="text-[11px] text-slate-500 block">{item.desc}</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{item.href}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Projects */}
          {filteredProjects.length > 0 && (
            <div>
              <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase px-2 mb-1 block">
                Projects
              </span>
              <div className="space-y-0.5">
                {filteredProjects.map((p) => {
                  const isCurrent = activeRepo === p.repo;
                  return (
                    <button
                      key={p.repo}
                      onClick={() => {
                        setActiveRepo(p.repo);
                        onClose();
                        router.push("/dashboard");
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md transition-colors group cursor-pointer text-left ${
                        isCurrent
                          ? "bg-slate-100 text-slate-950 font-semibold"
                          : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="h-5 w-5 rounded bg-slate-950 text-white flex items-center justify-center font-bold text-[10px] font-mono">
                          QA
                        </div>
                        <div>
                          <span className="font-medium flex items-center gap-2">
                            {p.name}
                            {isCurrent && (
                              <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1 py-0.2 rounded font-sans font-bold">
                                Current
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono block">{p.repo}</span>
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-400 group-hover:text-slate-900">Switch →</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span>Tip: Press <kbd className="text-slate-700 font-mono bg-white border border-slate-200 px-1 rounded shadow-2xs">F</kbd> anytime to open search</span>
          <span>AutoQA Platform</span>
        </div>
      </div>
    </div>
  );
}
