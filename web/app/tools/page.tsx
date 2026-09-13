"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Code2,
  FileCode2,
  Globe,
  Network,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import {
  TOOL_CATEGORIES,
  TOOLS_REGISTRY,
  ToolCategory,
  searchTools,
} from "@/lib/tools/tool-registry";

export default function ToolsHubPage() {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTools = useMemo(() => {
    return searchTools(searchQuery, selectedCategory);
  }, [searchQuery, selectedCategory]);

  const categoryIconMap: Record<string, React.ReactNode> = {
    seo: <Globe className="h-4 w-4" />,
    security: <ShieldCheck className="h-4 w-4" />,
    css: <Palette className="h-4 w-4" />,
    converters: <FileCode2 className="h-4 w-4" />,
    networking: <Terminal className="h-4 w-4" />,
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased selection:bg-slate-200">
      {/* Structural background grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light mask-radial-light opacity-70" />

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white font-mono font-bold text-xs shadow-xs group-hover:bg-slate-800 transition-colors">
                QA
              </div>
              <span className="font-bold text-slate-900 tracking-tight text-base">
                AutoQA Platform
              </span>
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Dev Tools Hub
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-xs transition-colors"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-10 space-y-8">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <span>Runs in your browser • SSL, CORS &amp; OpenGraph checks use a rate-limited server request</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900">
            Webmaster & Developer Utility Suite
          </h1>
          <p className="text-sm sm:text-base text-slate-600">
            Production-grade developer tools for modern web engineering. Generate meta tags, debug JWTs,
            verify CORS headers, calculate fluid typography, and transpile schemas.
          </p>
        </div>

        {/* Search & Category Filter Strip */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search tools by name, tag, or technology (e.g. CORS, clamp, JWT, SEO)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-9 pr-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white"
              />
            </div>

            {/* Quick stats pill */}
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="font-semibold text-slate-800">{filteredTools.length}</span> tools available
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-t border-slate-100 pt-3">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === "all"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>All Tools ({TOOLS_REGISTRY.length})</span>
            </button>

            {TOOL_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {categoryIconMap[cat.id]}
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tools Catalog Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTools.map((tool) => (
            <Link
              key={tool.id}
              href={`/tools/${tool.id}`}
              className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:shadow-md hover:border-slate-400 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-800 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                    {categoryIconMap[tool.category]}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {tool.badge && (
                      <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                        {tool.badge}
                      </span>
                    )}
                    <span className="rounded bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px] font-semibold">
                      {tool.categoryLabel}
                    </span>
                  </div>
                </div>

                <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  {tool.name}
                </h3>
                <p className="mt-1.5 text-xs text-slate-600 leading-relaxed line-clamp-2">
                  {tool.description}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {tool.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-slate-50 border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <span className="inline-flex items-center gap-1 font-semibold text-slate-900 group-hover:translate-x-0.5 transition-transform">
                  <span>Open</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* Bottom Platform CTA */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
          <div className="space-y-2 max-w-xl text-center md:text-left">
            <div className="inline-flex items-center gap-1.5 rounded bg-white/10 px-2 py-0.5 text-[11px] font-mono font-bold text-emerald-400">
              Autonomous Verification Engine
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight">
              Test your entire website autonomously with AutoQA
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Don&apos;t just debug one header or tag at a time. Run synthetic browser journeys with Playwright,
              visual regressions, and forensic video playback on every pull request.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-slate-100 shadow-xs transition-colors"
          >
            <span>Launch Live Test Journey</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
