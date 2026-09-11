"use client";

import { useState } from "react";
import { Globe, Play, RefreshCw, X, Shield, Sparkles, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExternalTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (runData: any) => void;
}

export function ExternalTestModal({ isOpen, onClose, onSuccess }: ExternalTestModalProps) {
  const [url, setUrl] = useState("https://example.com");
  const [testType, setTestType] = useState<"functional" | "functional+visual">("functional");
  const [routes, setRoutes] = useState("/");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setErrorMessage("Please specify a target website URL.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const routesList = routes
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          name: url.replace(/^https?:\/\//, "").split("/")[0],
          test_type: testType,
          routes: routesList.length > 0 ? routesList : ["/"],
        }),
      });

      const data = await res.json();
      if (!res.ok || data.status === "failed") {
        throw new Error(data.error || "Failed to enqueue verification run.");
      }

      onSuccess?.(data);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to launch external site testing.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-950">Verify External Website</h3>
            <p className="text-xs text-slate-500">Autonomous Playwright QA verification for live, staging, or non-GitHub web apps.</p>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
            {errorMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Target Website URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com or http://localhost:3000"
              disabled={isLoading}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
            {/* Quick preset tags */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] text-slate-400">Quick presets:</span>
              <button
                type="button"
                onClick={() => setUrl("https://example.com")}
                className="text-[11px] font-medium text-indigo-600 hover:underline"
              >
                example.com
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={() => setUrl("https://news.ycombinator.com")}
                className="text-[11px] font-medium text-indigo-600 hover:underline"
              >
                news.ycombinator.com
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Verification Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTestType("functional")}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  testType === "functional"
                    ? "border-indigo-600 bg-indigo-50/50 text-slate-900 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 mb-0.5">
                  <Layers className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Functional & Scroll</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Exploratory candidate discovery + element-targeted scroll testing.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTestType("functional+visual")}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  testType === "functional+visual"
                    ? "border-indigo-600 bg-indigo-50/50 text-slate-900 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 mb-0.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Functional + Vision</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Includes multimodal visual defect detection via Gemini 3.5.
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Target Sub-Routes (Comma separated)
            </label>
            <input
              type="text"
              value={routes}
              onChange={(e) => setRoutes(e.target.value)}
              placeholder="/, /pricing, /about"
              disabled={isLoading}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-600 flex items-start gap-2">
            <Shield className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong>Forensic artifacts generated:</strong> Real Chromium Playwright execution recording full screencast video (<code className="text-slate-800 font-mono">.webm</code>), CDP trace (<code className="text-slate-800 font-mono">.zip</code>), and DOM snapshots.
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
              className="text-xs h-9 px-4"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-9 px-5 gap-1.5 shadow-sm"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Dispatching Test…</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-white" />
                  <span>Launch Verification</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
