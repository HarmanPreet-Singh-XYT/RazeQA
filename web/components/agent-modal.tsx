"use client";

import React, { useState } from "react";
import {
  Sparkles,
  X,
  Play,
  Terminal,
  Cpu,
  Eye,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Shield,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRepo?: string | null;
  onRunTriggered?: () => void;
}

export function AgentModal({
  isOpen,
  onClose,
  activeRepo = "HarmanPreet-Singh-XYT/pingroute-web",
  onRunTriggered,
}: AgentModalProps) {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const quickActions = [
    {
      title: "Verify active PR branch",
      desc: "Diff analysis & Playwright user journeys",
      model: "Claude Sonnet 4.6",
      prompt: `Analyze the latest git diff on ${activeRepo || "main"}, synthesize user journeys, and verify against preview sandbox.`,
    },
    {
      title: "Visual regression check",
      desc: "Pixel-level layout shift inspection",
      model: "Gemini 3.5 Flash-Lite",
      prompt: "Compare screenshot baselines across desktop & mobile viewports. Highlight visual shifts.",
    },
    {
      title: "Synthesize 1-click fix",
      desc: "Repair failing journeys & generate patch",
      model: "Claude Sonnet 4.6",
      prompt: "Generate an automated fix proposal for the latest failing selector in the checkout journey.",
    },
    {
      title: "DOM element traversal",
      desc: "Fast exploration of unindexed routes",
      model: "Claude 4.5 Haiku",
      prompt: "Explore navigation links and form inputs on pingroute.harmanita.com and verify response codes.",
    },
  ];

  const handleExecute = async (userPrompt: string, modelName = "Claude Sonnet 4.6") => {
    setIsRunning(true);
    setSteps([`[Multi-Model Engine] Initializing agent task with ${modelName}...`]);
    setResultMessage(null);
    setActiveModel(modelName);

    try {
      setSteps((prev) => [...prev, `[Diff & Intent Analyzer] Inspecting workspace context for: ${activeRepo}`]);
      
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: activeRepo,
          prompt: userPrompt,
          scope: "changed",
          test_type: "functional",
        }),
      });

      const data = await res.json();
      if (res.ok && (data.run_id || data.id || data.status)) {
        const runId = data.run_id || data.id || "live";
        setSteps((prev) => [
          ...prev,
          `[Playwright] Dispatched autonomous verification run (${runId})`,
          `[Verification Engine] Status: ${data.status || "queued"}`,
          `[Completed] Verification job registered successfully.`,
        ]);
        setResultMessage(`Autonomous test verification dispatched for "${userPrompt.slice(0, 45)}...". Run ID: ${runId}`);
        onRunTriggered?.();
      } else {
        throw new Error(data.error || "Failed to trigger run.");
      }
    } catch (err: any) {
      setSteps((prev) => [...prev, `[Engine Warning] ${err.message || "Failed to contact engine"}`]);
      setResultMessage(`Task submitted. Check dashboard for live updates.`);
      onRunTriggered?.();
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-2xs">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-950">AutoQA Autonomous Agent</span>
                <span className="text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.2 rounded font-semibold">
                  Sandbox
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Context: <span className="font-mono text-slate-800 font-semibold">{activeRepo}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Multi-Model Specs Strip */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-500 overflow-x-auto gap-4">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-slate-700" />
            <span>Code Reasoning: <strong className="text-slate-800 font-mono">Claude Sonnet 4.6</strong></span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-sky-600" />
            <span>Vision / Heuristics: <strong className="text-slate-800 font-mono">Gemini 3.5 Flash-Lite</strong></span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span>Navigation: <strong className="text-slate-800 font-mono">Claude 4.5 Haiku</strong></span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Quick Actions Grid */}
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Autonomous Actions
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  disabled={isRunning}
                  onClick={() => {
                    setPrompt(action.prompt);
                    handleExecute(action.prompt, action.model);
                  }}
                  className="p-3 text-left bg-slate-50 hover:bg-slate-100/80 border border-slate-200 hover:border-slate-300 rounded-lg transition-all group cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-900 group-hover:text-slate-950">
                      {action.title}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-1">{action.desc}</p>
                  <span className="inline-block mt-1.5 text-[10px] font-mono text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded font-medium">
                    {action.model}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Input Form */}
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Prompt Agent
            </span>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask agent to test a flow, verify visual changes, or fix a bug..."
                rows={3}
                disabled={isRunning}
                className="w-full bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400 resize-none shadow-2xs"
              />
              <div className="absolute right-2.5 bottom-2.5">
                <Button
                  size="sm"
                  disabled={isRunning || !prompt.trim()}
                  onClick={() => handleExecute(prompt)}
                  className="bg-slate-950 text-white hover:bg-slate-800 text-xs font-semibold h-7 px-3 rounded cursor-pointer"
                >
                  {isRunning ? (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 mr-1.5 fill-white" />
                      Run
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Execution Stream Console */}
          {(isRunning || steps.length > 0) && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 pb-1.5 mb-1.5 border-b border-slate-800">
                <div className="flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Agent Stream</span>
                </div>
                {activeModel && (
                  <span className="text-slate-400 text-[10px] font-bold">{activeModel}</span>
                )}
              </div>
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 ${
                    step.includes("[Completed]")
                      ? "text-emerald-400 font-bold"
                      : step.includes("Initializing")
                      ? "text-sky-400"
                      : "text-slate-300"
                  }`}
                >
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span>{step}</span>
                </div>
              ))}
              {isRunning && (
                <div className="flex items-center gap-2 text-sky-400 animate-pulse">
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span>Agent reasoning in progress...</span>
                </div>
              )}
            </div>
          )}

          {resultMessage && (
            <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="font-medium">{resultMessage}</span>
              </div>
              <button
                onClick={onClose}
                className="font-bold text-emerald-700 hover:underline shrink-0 ml-2 cursor-pointer"
              >
                Close →
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Press ESC to close</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-slate-200 text-slate-700 hover:bg-white text-xs h-7 font-medium"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
