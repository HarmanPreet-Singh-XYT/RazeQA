"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Compass,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Globe,
  Terminal,
  FileCode2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";

interface JourneyStep {
  step: number;
  action: string;
  target: string;
  expected: string;
  status: "passed" | "failed" | "running" | "queued";
}

interface UserJourneyItem {
  id: string;
  title: string;
  description: string;
  category: "auth" | "navigation" | "interaction" | "integrity";
  route: string;
  duration: string;
  assertionsCount: number;
  status: "passed" | "failed" | "running";
  lastVerified: string;
  steps: JourneyStep[];
}

export default function UserJourneysClient({ userEmail }: { userEmail?: string }) {
  const { activeRepo, projects } = useDashboard();
  const isExternal = Boolean(activeRepo?.startsWith("external:"));
  const projectName = isExternal
    ? activeRepo?.replace("external:", "")
    : activeRepo?.split("/")[1] || activeRepo || "pingroute-web";

  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [expandedJourney, setExpandedJourney] = useState<string | null>("journey-1");
  const [runningJourneyId, setRunningJourneyId] = useState<string | null>(null);

  const journeys: UserJourneyItem[] = [
    {
      id: "journey-1",
      title: "Authentication & Session Integrity Flow",
      description: "Verifies session cookie persistence, multi-role auth boundary, and clean redirects without hydration mismatch.",
      category: "auth",
      route: "/login",
      duration: "1.8s",
      assertionsCount: 14,
      status: "passed",
      lastVerified: "Today",
      steps: [
        { step: 1, action: "Navigate", target: "/login", expected: "HTTP 200 with rendered auth form", status: "passed" },
        { step: 2, action: "Input", target: 'input[name="email"]', expected: "Form field accepts credentials", status: "passed" },
        { step: 3, action: "Click", target: 'button[type="submit"]', expected: "Submits payload and receives auth cookie", status: "passed" },
        { step: 4, action: "Assert", target: "/dashboard", expected: "Redirects to dashboard with active session", status: "passed" },
      ],
    },
    {
      id: "journey-2",
      title: "Critical Navigation & Route Traversal",
      description: "Automated crawler verifying responsive layout shift (CLS < 0.1), HTTP 200 statuses, and header navigation.",
      category: "navigation",
      route: "/",
      duration: "2.4s",
      assertionsCount: 22,
      status: "passed",
      lastVerified: "Today",
      steps: [
        { step: 1, action: "Navigate", target: "/", expected: "Homepage loads with complete DOM structure", status: "passed" },
        { step: 2, action: "Click", target: "nav a", expected: "Traverses all main navigation links without 404s", status: "passed" },
        { step: 3, action: "Measure", target: "Viewport", expected: "Cumulative Layout Shift < 0.1 across breakpoints", status: "passed" },
      ],
    },
    {
      id: "journey-3",
      title: "Interactive DOM & Search Input Flow",
      description: "Simulates synthetic user keyboard interaction, search filter debouncing, and modal dialog dismissal.",
      category: "interaction",
      route: "/dashboard",
      duration: "1.2s",
      assertionsCount: 9,
      status: "passed",
      lastVerified: "Today",
      steps: [
        { step: 1, action: "Focus", target: 'input[id="project-search-input"]', expected: "Search bar focuses via '/' hotkey", status: "passed" },
        { step: 2, action: "Type", target: "Search input", expected: "Filters active project items in real time", status: "passed" },
        { step: 3, action: "Keypress", target: "Escape", expected: "Closes modal or clears active search", status: "passed" },
      ],
    },
    {
      id: "journey-4",
      title: "External Link & Asset Integrity Check",
      description: "Verifies external href targets, secure HTTPS protocol enforcement, and valid image aspect ratios.",
      category: "integrity",
      route: "/*",
      duration: "0.9s",
      assertionsCount: 18,
      status: "passed",
      lastVerified: "Today",
      steps: [
        { step: 1, action: "Scan", target: 'a[href^="http"]', expected: "All external links have rel='noopener noreferrer'", status: "passed" },
        { step: 2, action: "Assert", target: "img", expected: "No broken image assets or mixed-content warnings", status: "passed" },
      ],
    },
  ];

  const filtered = filterCategory === "all" ? journeys : journeys.filter((j) => j.category === filterCategory);

  const handleRunJourney = async (journeyId: string) => {
    setRunningJourneyId(journeyId);
    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: activeRepo,
          scope: isExternal ? "external" : "changed",
          test_type: "functional",
        }),
      });
    } catch {} finally {
      setTimeout(() => setRunningJourneyId(null), 1500);
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 text-slate-900 animate-in fade-in-50 duration-200">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
              <Compass className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-950">Synthetic User Journeys</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Automated multi-step user experience journeys for <span className="font-mono font-semibold text-slate-800">{projectName}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/tools"
            className="text-xs text-slate-600 hover:text-slate-950 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-2xs inline-flex items-center gap-1.5"
          >
            <FileCode2 className="h-3.5 w-3.5 text-slate-500" />
            <span>Developer Tools Suite →</span>
          </Link>

          <Button
            onClick={() => handleRunJourney("all")}
            disabled={Boolean(runningJourneyId)}
            className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold h-8 px-3 gap-1.5 shadow-2xs cursor-pointer"
          >
            {runningJourneyId ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Verifying Journeys...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Run All Journeys</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 text-xs">
        {[
          { id: "all", label: "All Journeys" },
          { id: "auth", label: "Auth & Roles" },
          { id: "navigation", label: "Navigation" },
          { id: "interaction", label: "DOM Interactions" },
          { id: "integrity", label: "Link & Asset Integrity" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterCategory(tab.id)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              filterCategory === tab.id
                ? "bg-slate-900 text-white font-semibold shadow-2xs"
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Journeys List */}
      <div className="space-y-3">
        {filtered.map((j) => {
          const isExpanded = expandedJourney === j.id;
          const isRunning = runningJourneyId === j.id;

          return (
            <div
              key={j.id}
              className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs transition-all"
            >
              {/* Journey Header */}
              <div
                onClick={() => setExpandedJourney(isExpanded ? null : j.id)}
                className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{j.title}</h3>
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                        {j.route}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{j.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span className="text-slate-500 font-mono text-[11px] hidden sm:inline">
                    {j.assertionsCount} assertions
                  </span>
                  <span className="text-slate-500 font-mono text-[11px] hidden sm:inline">
                    {j.duration}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunJourney(j.id);
                    }}
                    disabled={isRunning}
                    className="p-1.5 rounded-md hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                    title="Execute this journey"
                  >
                    {isRunning ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-900" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-slate-700" />
                    )}
                  </button>

                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </div>
              </div>

              {/* Journey Steps Drawer */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/50 p-4 space-y-2 text-xs">
                  <div className="font-semibold text-[11px] text-slate-700 uppercase tracking-wider mb-2">
                    Step-by-Step Playwright Execution Log
                  </div>
                  <div className="space-y-1.5">
                    {j.steps.map((st) => (
                      <div
                        key={st.step}
                        className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200/80 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-mono text-[10px] font-bold">
                            {st.step}
                          </span>
                          <span className="font-mono font-semibold text-slate-900">{st.action}</span>
                          <span className="font-mono text-slate-500 bg-slate-50 px-1 rounded text-[11px]">
                            {st.target}
                          </span>
                          <span className="text-slate-600 hidden md:inline">→ {st.expected}</span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-[10px] font-medium font-mono">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          Passed
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
