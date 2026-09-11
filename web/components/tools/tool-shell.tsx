"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { ToolDefinition } from "@/lib/tools/tool-registry";

interface ToolShellProps {
  tool: ToolDefinition;
  children: React.ReactNode;
  outputCode?: string;
  outputFilename?: string;
  onReset?: () => void;
  controlsHeader?: React.ReactNode;
}

export function ToolShell({
  tool,
  children,
  outputCode,
  outputFilename = "output.txt",
  onReset,
  controlsHeader,
}: ToolShellProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!outputCode) return;
    navigator.clipboard.writeText(outputCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!outputCode) return;
    const blob = new Blob([outputCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = outputFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Link
                href="/tools"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>All Tools</span>
              </Link>
              <span className="text-slate-300">/</span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {tool.categoryLabel}
              </span>
              {tool.badge && (
                <span className="rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold">
                  {tool.badge}
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {tool.name}
            </h1>
            <p className="mt-1 text-sm text-slate-600 max-w-3xl">
              {tool.detailedDescription}
            </p>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 shrink-0">
            {onReset && (
              <button
                onClick={onReset}
                title="Reset to defaults"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}

            {outputCode && (
              <>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-all shadow-xs active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Output</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleDownload}
                  title="Download output file"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  <span>Export</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Synergy Banner with Autonomous Testing Platform */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-indigo-950">
            <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>
              <strong className="font-semibold">AutoQA Synergy:</strong> {tool.synergyHint}
            </span>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900 transition-colors shrink-0"
          >
            <span>Run Automated Journey Test</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div>{children}</div>
    </div>
  );
}
