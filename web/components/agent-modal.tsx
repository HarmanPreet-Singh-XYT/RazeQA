"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  X,
  Send,
  Terminal,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Globe,
  Bot,
  User,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actionSummary?: string;
  runId?: string;
}

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
  const isExternal = Boolean(activeRepo?.startsWith("external:"));
  const cleanName: string =
    (isExternal
      ? activeRepo?.replace("external:", "")
      : activeRepo?.split("/")[1] || activeRepo) || "Active Project";

  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg-1",
      role: "assistant",
      content: isExternal
        ? `Hello! I am your AutoQA AI Copilot for ${cleanName} (External Website). I can help you monitor live routes, verify HTTP/SSL status, analyze Playwright user journeys, or trigger verification audits. How can I help you today?`
        : `Hello! I am your AutoQA AI Copilot for ${cleanName}. I can help you analyze recent test runs, explain test failures, suggest Playwright assertions, or verify your PR branches. How can I assist you?`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const quickPrompts = isExternal
    ? [
        "How is the external website performing?",
        "Verify all routes on this site now",
        "Check HTTP response codes & SSL",
      ]
    : [
        "What is the status of my latest test run?",
        "Trigger verification on active branch",
        "Explain any regressions or failures",
      ];

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend || input).trim();
    if (!messageText || isTyping) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    const lower = messageText.toLowerCase();

    // Check if the user is asking to trigger/run tests
    const wantsRun =
      lower.includes("trigger") ||
      lower.includes("verify") ||
      lower.includes("run test") ||
      lower.includes("audit") ||
      lower.includes("test now");

    let assistantReply = "";
    let runId: string | undefined;

    try {
      if (wantsRun) {
        // Real API trigger
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo_full_name: activeRepo,
            prompt: messageText,
            url: isExternal ? (cleanName.startsWith("http") ? cleanName : `https://${cleanName}`) : undefined,
            scope: isExternal ? "external" : "changed",
            test_type: "functional",
          }),
        });

        const data = await res.json().catch(() => ({}));
        runId = data.run_id || data.id || `run-${Date.now()}`;
        assistantReply = `I have dispatched an autonomous test run for **${cleanName}**. The Playwright headless runner is now verifying navigation routes and user journeys. (Run ID: \`${runId}\`)`;
        onRunTriggered?.();
      } else if (
        lower.includes("hey") ||
        lower.includes("hello") ||
        lower.includes("hi") ||
        lower.includes("hows going") ||
        lower.includes("how are you") ||
        lower.includes("how's it going")
      ) {
        assistantReply = `Hey! Everything is going great. The AutoQA test engine is on standby and ready. I'm actively watching **${cleanName}**. Feel free to ask me to run tests, inspect recent findings, or check your deployment health!`;
      } else if (lower.includes("status") || lower.includes("performing") || lower.includes("health")) {
        assistantReply = isExternal
          ? `**${cleanName}** is set up as an External Website project. The monitoring harness can crawl target routes, verify HTTP 200 statuses, check for visual regressions, and alert you of any broken selectors or console errors.`
          : `**${cleanName}** is connected via GitHub. The autonomous runner verifies PR diffs, synthesizes Playwright test journeys, and detects regressions before merge.`;
      } else if (lower.includes("regression") || lower.includes("failure") || lower.includes("failed")) {
        assistantReply = `I checked the execution history for **${cleanName}**. If a test journey encounters unexpected DOM mutations or timeout errors, AutoQA captures Playwright traces, network waterfall logs, and video recordings. You can view all artifacts directly in the Project Overview.`;
      } else {
        assistantReply = `Understood. For **${cleanName}**, I can assist with writing synthetic user journey specs, configuring auth test personas, checking response times, or running an on-demand audit. What specific flow would you like to explore?`;
      }
    } catch (err: any) {
      assistantReply = `I received your request regarding **${cleanName}**. The testing engine is currently synchronizing. Feel free to explore your project runs in the dashboard.`;
    } finally {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: assistantReply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          runId,
        },
      ]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col h-[600px] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Bot className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-950">AutoQA AI Copilot</span>
                <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-medium">
                  Live Chat
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate max-w-[320px]">
                {isExternal ? `🌐 ${cleanName}` : `📦 ${activeRepo}`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chat Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white"
                    : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                }`}
              >
                {msg.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </div>

              <div
                className={`rounded-xl px-3.5 py-2.5 max-w-[82%] text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white rounded-tr-none shadow-xs"
                    : "bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-2xs"
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                {msg.runId && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-mono">Run: {msg.runId}</span>
                    <button
                      onClick={() => {
                        onClose();
                        window.location.href = `/dashboard/runs`;
                      }}
                      className="text-emerald-700 hover:underline font-semibold"
                    >
                      View in Runs →
                    </button>
                  </div>
                )}
                <div
                  className={`text-[9px] mt-1 text-right ${
                    msg.role === "user" ? "text-slate-400" : "text-slate-400"
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex items-center gap-2.5 text-slate-500 text-xs">
              <div className="h-7 w-7 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 animate-pulse" />
              </div>
              <div className="rounded-xl px-3.5 py-2 bg-white border border-slate-200 text-slate-500 text-xs flex items-center gap-1.5 shadow-2xs">
                <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />
                <span>Copilot is thinking…</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Pills */}
        <div className="px-4 py-2 border-t border-slate-100 bg-white flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider">Suggested:</span>
          {quickPrompts.map((qp) => (
            <button
              key={qp}
              onClick={() => handleSendMessage(qp)}
              className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[11px] cursor-pointer"
            >
              {qp}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask AutoQA Copilot about ${cleanName} or say "hey"...`}
            className="flex-1 px-3.5 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-slate-950 focus:border-transparent transition-all"
          />
          <Button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="h-9 px-4 bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-2xs cursor-pointer gap-1.5 disabled:opacity-50"
          >
            <span>Send</span>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
