"use client";

import React, { useState, useEffect } from "react";
import {
  Globe,
  ExternalLink,
  Plus,
  Trash2,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  Save,
  Shield,
  Layers,
  Check,
  Smartphone,
  Monitor,
  Tablet,
  Sliders,
  Terminal,
  Activity,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectInfo } from "@/components/dashboard-context";
import { RepositorySwitcher } from "@/components/repository-switcher";

interface ExternalProjectSettingsProps {
  selectedRepo: string;
  allProjects: ProjectInfo[];
  onSelectProject: (repoFullName: string) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function ExternalProjectSettings({
  selectedRepo,
  allProjects,
  onSelectProject,
  activeTab,
  onTabChange,
}: ExternalProjectSettingsProps) {
  const cleanHostname = selectedRepo.replace(/^external:/, "");
  const defaultUrl = cleanHostname.startsWith("http") ? cleanHostname : `https://${cleanHostname}`;

  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [routes, setRoutes] = useState<string[]>(["/", "/search", "/pricing", "/about"]);
  const [newRoute, setNewRoute] = useState("");

  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([
    { key: "User-Agent", value: "AutoQA-Playwright-Autonomous-Crawler/2.0" },
  ]);
  const [newHeaderKey, setNewHeaderKey] = useState("");
  const [newHeaderVal, setNewHeaderVal] = useState("");

  const [viewports, setViewports] = useState({
    desktop: true,
    mobile: true,
    tablet: false,
  });

  const [timeoutSec, setTimeoutSec] = useState(30);
  const [ignoreSslErrors, setIgnoreSslErrors] = useState(true);
  const [scheduledFrequency, setScheduledFrequency] = useState("daily");

  const [runs, setRuns] = useState<any[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isTriggeringRun, setIsTriggeringRun] = useState(false);
  const [runSuccessMsg, setRunSuccessMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load persisted routes & headers from localStorage
  useEffect(() => {
    try {
      const storedRoutes = localStorage.getItem(`autoqa_routes_${cleanHostname}`);
      if (storedRoutes) {
        setRoutes(JSON.parse(storedRoutes));
      }
      const storedHeaders = localStorage.getItem(`autoqa_headers_${cleanHostname}`);
      if (storedHeaders) {
        setHeaders(JSON.parse(storedHeaders));
      }
    } catch {}
  }, [cleanHostname]);

  // Load runs for this external site
  const fetchSiteRuns = async () => {
    setIsLoadingRuns(true);
    try {
      const res = await fetch("/api/runs");
      if (res.ok) {
        const data = await res.json();
        const allRuns = Array.isArray(data) ? data : data.runs || [];
        const filtered = allRuns.filter((r: any) => {
          const isExternal = r.scope === "external" || r.branch?.startsWith("http") || r.sha?.startsWith("http");
          if (!isExternal) return false;
          const runUrl = r.sha?.startsWith("http") ? r.sha : r.branch?.replace("🌐 ", "") || r.result?.target_url || "";
          return runUrl.includes(cleanHostname);
        });
        setRuns(filtered);
      }
    } catch (err) {
      console.error("Failed to load site runs:", err);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  useEffect(() => {
    fetchSiteRuns();
  }, [cleanHostname]);

  const handleAddRoute = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRoute.trim();
    if (!trimmed) return;
    const formatted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (!routes.includes(formatted)) {
      const updated = [...routes, formatted];
      setRoutes(updated);
      try {
        localStorage.setItem(`autoqa_routes_${cleanHostname}`, JSON.stringify(updated));
      } catch {}
    }
    setNewRoute("");
  };

  const handleRemoveRoute = (routeToRemove: string) => {
    const updated = routes.filter((r) => r !== routeToRemove);
    setRoutes(updated);
    try {
      localStorage.setItem(`autoqa_routes_${cleanHostname}`, JSON.stringify(updated));
    } catch {}
  };

  const handleAddHeader = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHeaderKey.trim()) return;
    const updated = [...headers, { key: newHeaderKey.trim(), value: newHeaderVal.trim() }];
    setHeaders(updated);
    try {
      localStorage.setItem(`autoqa_headers_${cleanHostname}`, JSON.stringify(updated));
    } catch {}
    setNewHeaderKey("");
    setNewHeaderVal("");
  };

  const handleRemoveHeader = (index: number) => {
    const updated = headers.filter((_, i) => i !== index);
    setHeaders(updated);
    try {
      localStorage.setItem(`autoqa_headers_${cleanHostname}`, JSON.stringify(updated));
    } catch {}
  };

  const handleSave = () => {
    setIsSaving(true);
    try {
      localStorage.setItem(`autoqa_routes_${cleanHostname}`, JSON.stringify(routes));
      localStorage.setItem(`autoqa_headers_${cleanHostname}`, JSON.stringify(headers));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch {}
    setIsSaving(false);
  };

  const handleTriggerRun = async () => {
    setIsTriggeringRun(true);
    setRunSuccessMsg(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: selectedRepo,
          url: targetUrl,
          scope: "external",
          test_type: "functional",
          routes: routes,
        }),
      });
      const data = await res.json();
      setRunSuccessMsg(`Verification run queued! Run ID: ${data.run_id || data.id || "queued"}`);
      setTimeout(() => setRunSuccessMsg(null), 5000);
      fetchSiteRuns();
    } catch (err: any) {
      setRunSuccessMsg("Failed to dispatch run.");
    } finally {
      setIsTriggeringRun(false);
    }
  };

  const showRoutesSection = activeTab === "all" || activeTab === "routes" || activeTab === "repo-build";
  const showHeadersSection = activeTab === "all" || activeTab === "headers" || activeTab === "roles" || activeTab === "env-vars";
  const showHistorySection = activeTab === "all" || activeTab === "runs" || activeTab === "auto-repair";

  return (
    <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 text-slate-900 animate-in fade-in-50 duration-200">
      {/* Top Banner & Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 flex items-center gap-2">
              <Globe className="h-5 w-5 text-sky-600" />
              External Website Settings &amp; Verification
            </h1>

            {/* Switch Project Pill — same catalogue as the Git settings tab, so
                an external site can be swapped straight to a connected repo. */}
            <RepositorySwitcher
              selectedRepo={selectedRepo}
              projects={allProjects}
              onSelect={(repo) => onSelectProject(repo)}
              variant="external"
            />
          </div>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Configure crawl paths, responsive viewports, custom HTTP headers, and automated synthetic verification for live websites.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            onClick={handleTriggerRun}
            disabled={isTriggeringRun}
            variant="outline"
            className="border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold text-xs px-3 py-1.5 h-8 gap-1.5 shadow-2xs cursor-pointer"
          >
            {isTriggeringRun ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-600" />
            ) : (
              <Play className="h-3.5 w-3.5 text-sky-600 fill-sky-600" />
            )}
            <span>Trigger Audit</span>
          </Button>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-slate-950 hover:bg-slate-800 text-white font-medium text-xs px-3.5 py-1.5 h-8 gap-1.5 shadow-sm transition-all cursor-pointer"
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
      </div>

      {/* Trigger Feedback Alert */}
      {runSuccessMsg && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 flex items-center justify-between shadow-2xs animate-in fade-in-50">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
            <span>{runSuccessMsg}</span>
          </div>
          <button
            onClick={() => setRunSuccessMsg(null)}
            className="text-sky-700 hover:underline font-semibold ml-2 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* External Settings Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-0 text-xs select-none no-scrollbar">
        <button
          type="button"
          onClick={() => onTabChange("all")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "all"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>All Configurations</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("routes")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "routes" || activeTab === "repo-build"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Globe className="h-3.5 w-3.5 text-sky-600" />
          <span>Target &amp; Crawl Routes</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("headers")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "headers" || activeTab === "roles" || activeTab === "env-vars"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Shield className="h-3.5 w-3.5 text-emerald-600" />
          <span>Headers &amp; Auth Cookies</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("runs")}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === "runs" || activeTab === "auto-repair"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
          }`}
        >
          <Layers className="h-3.5 w-3.5 text-indigo-600" />
          <span>Verification Run History</span>
        </button>
      </div>

      {/* =========================================================================
          SECTION 1: TARGET URL & MONITORED ROUTES
          ========================================================================= */}
      {showRoutesSection && (
        <div className="space-y-6">
          {/* Target Website Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-sky-600" />
                <span className="text-sm font-bold text-slate-950">Live Website Target</span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Monitoring Active
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Target Website Base URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <a
                    href={targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <span>Visit</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-[11px] text-slate-500">
                  AutoQA crawls and verifies Playwright user journeys against this target domain.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Audit Frequency</label>
                <select
                  value={scheduledFrequency}
                  onChange={(e) => setScheduledFrequency(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none"
                >
                  <option value="hourly">Every hour</option>
                  <option value="daily">Daily synthetic check</option>
                  <option value="weekly">Weekly health check</option>
                  <option value="manual">Manual on-demand only</option>
                </select>
                <p className="text-[11px] text-slate-500">Autonomous test runner interval.</p>
              </div>
            </div>
          </div>

          {/* Monitored Routes Table */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-sm font-bold text-slate-950">Monitored Crawl Routes</span>
                <p className="text-xs text-slate-500">Paths traversed during synthetic Playwright test journeys.</p>
              </div>
              <span className="text-xs font-mono text-slate-500 font-semibold">
                {routes.length} paths registered
              </span>
            </div>

            {/* Add Route Form */}
            <form onSubmit={handleAddRoute} className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2 text-xs font-mono text-slate-400">
                  {targetUrl.replace(/\/$/, "")}
                </span>
                <input
                  type="text"
                  placeholder="/search, /pricing, /about"
                  value={newRoute}
                  onChange={(e) => setNewRoute(e.target.value)}
                  className="w-full pl-[calc(14ch+1rem)] pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="text-xs px-3 py-1.5 h-8 gap-1.5 border-slate-300 hover:bg-slate-100 text-slate-800 cursor-pointer shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Path</span>
              </Button>
            </form>

            {/* Routes List */}
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
              {routes.map((r) => (
                <div key={r} className="flex items-center justify-between p-2.5 px-3 hover:bg-white transition-colors text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="font-mono font-semibold text-slate-800 truncate">{r}</span>
                    <span className="text-[10px] text-slate-400 font-mono hidden sm:inline truncate">
                      {targetUrl.replace(/\/$/, "")}{r}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`${targetUrl.replace(/\/$/, "")}${r}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-slate-700 p-1 rounded"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {routes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRoute(r)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                        title="Remove route"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Viewport & Device Emulation */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-950">Synthetic Device Emulation</span>
              <p className="text-xs text-slate-500">Viewports emulated during headless Playwright visual and functional checks.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  viewports.desktop ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={viewports.desktop}
                  onChange={(e) => setViewports({ ...viewports, desktop: e.target.checked })}
                  className="rounded text-slate-900"
                />
                <Monitor className="h-4 w-4 text-slate-700" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Desktop</div>
                  <div className="text-[10px] font-mono text-slate-500">1920 × 1080 (Chrome)</div>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  viewports.mobile ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={viewports.mobile}
                  onChange={(e) => setViewports({ ...viewports, mobile: e.target.checked })}
                  className="rounded text-slate-900"
                />
                <Smartphone className="h-4 w-4 text-slate-700" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Mobile</div>
                  <div className="text-[10px] font-mono text-slate-500">390 × 844 (iPhone 14)</div>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  viewports.tablet ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={viewports.tablet}
                  onChange={(e) => setViewports({ ...viewports, tablet: e.target.checked })}
                  className="rounded text-slate-900"
                />
                <Tablet className="h-4 w-4 text-slate-700" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Tablet</div>
                  <div className="text-[10px] font-mono text-slate-500">820 × 1180 (iPad Air)</div>
                </div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 2: HEADERS & AUTH COOKIES
          ========================================================================= */}
      {showHeadersSection && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-sm font-bold text-slate-950">Custom HTTP Request Headers &amp; Tokens</span>
                <p className="text-xs text-slate-500">
                  Injected into Playwright request context to bypass basic auth, Cloudflare access, or test private staging environments.
                </p>
              </div>
            </div>

            {/* Add Header Form */}
            <form onSubmit={handleAddHeader} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <input
                type="text"
                placeholder="Header Name (e.g. X-Preview-Token)"
                value={newHeaderKey}
                onChange={(e) => setNewHeaderKey(e.target.value)}
                className="sm:col-span-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none"
              />
              <input
                type="text"
                placeholder="Header Value / Token"
                value={newHeaderVal}
                onChange={(e) => setNewHeaderVal(e.target.value)}
                className="sm:col-span-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-900 focus:bg-white focus:outline-none"
              />
              <Button
                type="submit"
                variant="outline"
                className="text-xs px-3 py-1.5 h-8 gap-1.5 border-slate-300 hover:bg-slate-100 text-slate-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Header</span>
              </Button>
            </form>

            {/* Headers List */}
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 px-3 hover:bg-white transition-colors text-xs font-mono">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-900">{h.key}:</span>
                    <span className="text-slate-600 truncate">{h.value}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveHeader(i)}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Crawler Engine Configuration */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-950">Engine Parameters</span>
              <p className="text-xs text-slate-500">Autonomous browser timeout and TLS security configuration.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">Navigation Timeout (Seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(parseInt(e.target.value, 10) || 30)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 font-mono focus:bg-white focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">SSL &amp; Self-Signed Certificates</label>
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ignoreSslErrors}
                    onChange={(e) => setIgnoreSslErrors(e.target.checked)}
                    className="rounded text-slate-900"
                  />
                  <span className="text-slate-800">Ignore HTTPS/SSL certificate errors (Staging)</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 3: RUN HISTORY FOR THIS EXTERNAL SITE
          ========================================================================= */}
      {showHistorySection && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <span className="text-sm font-bold text-slate-950">External Verification Runs</span>
              <p className="text-xs text-slate-500">Execution logs and synthetic audit history for {cleanHostname}.</p>
            </div>
            <Button
              onClick={fetchSiteRuns}
              variant="outline"
              className="text-xs px-2.5 py-1 h-7 border-slate-200 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${isLoadingRuns ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
          </div>

          {isLoadingRuns ? (
            <div className="py-8 text-center text-xs text-slate-400">Loading verification records...</div>
          ) : runs.length === 0 ? (
            <div className="py-8 text-center space-y-2 text-slate-400">
              <Activity className="h-6 w-6 mx-auto text-slate-300" />
              <p className="text-xs">No verification runs recorded yet for this URL.</p>
              <Button
                onClick={handleTriggerRun}
                className="bg-slate-950 text-white text-xs px-3 py-1.5 h-8 mt-2"
              >
                Trigger First Verification
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden text-xs">
              {runs.map((r: any) => {
                const isPassed = r.status === "passed" || r.result?.status === "success";
                const isFailed = r.status === "failed" || r.result?.status === "failed";
                return (
                  <div key={r.id || r.run_id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {isPassed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : isFailed ? (
                        <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                      ) : (
                        <Activity className="h-4 w-4 text-sky-600 shrink-0 animate-pulse" />
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {r.result?.summary || `Autonomous Audit for ${cleanHostname}`}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>{r.id || r.run_id}</span>
                          <span>•</span>
                          <span>{r.created_at ? new Date(r.created_at).toLocaleString() : "Just now"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        isPassed
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : isFailed
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-sky-50 text-sky-700 border border-sky-200"
                      }`}>
                        {r.status || "completed"}
                      </span>
                      <a
                        href={
                          r.id || r.run_id
                            ? `/dashboard/runs/${encodeURIComponent(r.id || r.run_id)}/analytics`
                            : `/dashboard/runs?repo=${encodeURIComponent(selectedRepo)}`
                        }
                        className="text-slate-400 hover:text-slate-700 p-1"
                        title="View run forensics"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
