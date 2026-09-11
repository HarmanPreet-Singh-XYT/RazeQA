"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  ExternalLink,
  FileCode2,
  GitBranch,
  Globe,
  Network,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  TOOL_CATEGORIES,
  TOOLS_REGISTRY,
  ToolCategory,
  ToolDefinition,
  searchTools,
} from "@/lib/tools/tool-registry";
import { ToolRenderer } from "@/components/tools/tool-renderer";

interface ToolsDashboardClientProps {
  userEmail: string;
}

export default function ToolsDashboardClient({ userEmail }: ToolsDashboardClientProps) {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeToolId, setActiveToolId] = useState<string>("open-graph-previewer");

  const filteredTools = searchTools(searchQuery, selectedCategory);
  const activeTool = TOOLS_REGISTRY.find((t) => t.id === activeToolId) || TOOLS_REGISTRY[0];

  const categoryIconMap: Record<string, React.ReactNode> = {
    seo: <Globe className="h-4 w-4" />,
    security: <ShieldCheck className="h-4 w-4" />,
    css: <Palette className="h-4 w-4" />,
    converters: <FileCode2 className="h-4 w-4" />,
    networking: <Terminal className="h-4 w-4" />,
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased flex flex-col">
      {/* 1. Global Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Brand & Repo Context */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="h-7 w-7 rounded-lg bg-slate-950 text-white font-mono font-bold text-xs flex items-center justify-center shadow-xs group-hover:bg-slate-800 transition-colors">
                PR
              </div>
              <span className="font-bold text-slate-950 text-sm tracking-tight hidden sm:inline-block">
                AutoQA Platform
              </span>
            </Link>

            <span className="text-slate-300">/</span>

            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">
              <GitBranch className="h-3.5 w-3.5 text-slate-500" />
              <span>acme-corp / ecommerce-web</span>
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
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
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
                className="rounded-md px-2.5 py-1 text-xs font-bold text-slate-950 bg-slate-100 transition-colors"
              >
                Dev Tools
              </Link>
            </nav>
          </div>

          {/* User Email & Sign Out */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher />

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="h-6 w-6 rounded-full bg-slate-900 text-white font-bold text-[10px] flex items-center justify-center">
                QA
              </div>
              <span className="text-xs font-medium text-slate-700 hidden md:inline-block">
                {userEmail}
              </span>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="text-xs text-slate-500 hover:text-slate-900 font-medium transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* 2. Main Split Workspace */}
      <main className="mx-auto max-w-7xl px-6 py-6 flex-1 flex flex-col lg:flex-row gap-6">
        {/* Left Sidebar: Tools Catalog & Switcher (340px) */}
        <aside className="w-full lg:w-80 shrink-0 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Toolbox Directory
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {filteredTools.length} tools
              </span>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
              />
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
              <button
                onClick={() => setSelectedCategory("all")}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  selectedCategory === "all"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                All
              </button>
              {TOOL_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`rounded px-2 py-0.5 font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === c.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {c.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Tools Scrollable Feed */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
            {filteredTools.map((tool) => {
              const isSelected = tool.id === activeTool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveToolId(tool.id)}
                  className={`w-full text-left p-3.5 transition-all flex items-start justify-between gap-2 ${
                    isSelected
                      ? "bg-slate-100/90 border-l-4 border-slate-950 font-semibold"
                      : "hover:bg-slate-50/80"
                  }`}
                >
                  <div className="space-y-1 overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-700">
                        {categoryIconMap[tool.category]}
                      </span>
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {tool.shortName || tool.name}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-1">
                      {tool.description}
                    </p>
                  </div>

                  {tool.badge && (
                    <span className="shrink-0 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 text-[9px] font-bold">
                      {tool.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Public Page Share link */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-between text-xs">
            <span className="text-slate-600">Open full page view:</span>
            <Link
              href={`/tools/${activeTool.id}`}
              target="_blank"
              className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <span>/tools/{activeTool.id}</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </aside>

        {/* Right Pane: Active Tool Renderer */}
        <section className="flex-1 overflow-hidden">
          <ToolRenderer tool={activeTool} />
        </section>
      </main>
    </div>
  );
}
