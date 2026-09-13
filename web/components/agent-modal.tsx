"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Send,
  RefreshCw,
  Bot,
  User,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A single chat turn. `runId` is only ever set from a run the engine actually
 * dispatched — never synthesised client-side.
 */
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  runId?: string;
  runStatus?: string;
  error?: boolean;
  model?: string;
  provider?: string;
}

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRepo?: string | null;
  onRunTriggered?: () => void;
  /** Target URL for `external:` projects, which live in browser storage. */
  targetUrl?: string | null;
}

/** How many prior turns are sent back as conversation context. */
const HISTORY_WINDOW = 8;

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function threadKey(repo: string | null | undefined): string {
  return `autoqa_copilot_thread_${repo || "workspace"}`;
}

/**
 * Render the small amount of markdown the copilot emits: bold, inline code, and
 * bullet lists. Deliberately not a full markdown engine — the alternative was
 * injecting model output as HTML, which is not acceptable for untrusted text.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10.5px] text-slate-800"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MessageBody({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
        if (bullet) {
          return (
            <div key={index} className="flex gap-1.5">
              <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
              <span>{renderInline(bullet[1])}</span>
            </div>
          );
        }

        const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
        if (numbered) {
          return (
            <div key={index} className="flex gap-1.5">
              <span className="shrink-0 font-semibold opacity-70">{numbered[1]}.</span>
              <span>{renderInline(numbered[2])}</span>
            </div>
          );
        }

        const heading = /^#{1,4}\s+(.*)$/.exec(trimmed);
        if (heading) {
          return (
            <p key={index} className="font-semibold">
              {renderInline(heading[1])}
            </p>
          );
        }

        return <p key={index}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

export function AgentModal({
  isOpen,
  onClose,
  activeRepo,
  onRunTriggered,
  targetUrl,
}: AgentModalProps) {
  const isExternal = Boolean(activeRepo?.startsWith("external:"));
  const cleanName: string =
    (isExternal
      ? activeRepo?.replace("external:", "")
      : activeRepo?.split("/")[1] || activeRepo) || "Active Project";

  // The copilot is scoped to one project, so its run links must be too.
  const runsHref = activeRepo
    ? `/dashboard/runs?repo=${encodeURIComponent(activeRepo)}`
    : "/dashboard/runs";

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [engineUnavailable, setEngineUnavailable] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const storageKey = threadKey(activeRepo);

  // Load the persisted thread for this project so reopening the modal resumes
  // the conversation instead of silently discarding it.
  useEffect(() => {
    if (!isOpen) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          return;
        }
      }
    } catch {
      // Corrupt or unavailable storage: start a clean thread.
    }
    setMessages([]);
  }, [isOpen, storageKey]);

  // Persist after every turn, including the greeting.
  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      // Storage full or blocked: the conversation still works in-memory.
    }
  }, [messages, isOpen, storageKey]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isThinking]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const greeting = useMemo<ChatMessage>(
    () => ({
      id: "greeting",
      role: "assistant",
      content: isExternal
        ? `Hello! I am your AutoQA AI Copilot for **${cleanName}** (External Website). I can explain recent verification runs, check route and HTTP findings, or trigger a fresh audit of this site. What would you like to look at?`
        : `Hello! I am your AutoQA AI Copilot for **${cleanName}**. I can explain recent test runs, summarize failures, review your configuration, or trigger a verification run. What would you like to know?`,
      timestamp: nowLabel(),
    }),
    [cleanName, isExternal]
  );

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

  const handleSendMessage = useCallback(
    async (textToSend?: string) => {
      const messageText = (textToSend || input).trim();
      if (!messageText || isThinking) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: messageText,
        timestamp: nowLabel(),
      };

      // Build history from the current thread, excluding the greeting so the
      // model is not told it already said hello.
      const history = [...messages]
        .filter((m) => m.id !== "greeting")
        .slice(-HISTORY_WINDOW)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsThinking(true);
      setEngineUnavailable(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: messageText,
            history,
            repo_full_name: activeRepo || "",
            branch: "main",
            allow_trigger: true,
            target_url: targetUrl || undefined,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const detail = data.error || `Copilot request failed (HTTP ${res.status}).`;
          setEngineUnavailable(detail);
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              content: `I could not reach the testing engine: ${detail}`,
              timestamp: nowLabel(),
              error: true,
            },
          ]);
          return;
        }

        setLastModel(data.model || null);

        const run = data.triggered_run;
        const runFailed = run && (run.status === "failed" || !run.run_id);
        setMessages((prev) => [
          ...prev,
          {
            id: `reply-${Date.now()}`,
            role: "assistant",
            content:
              data.reply ||
              "I did not receive an answer for that. Check the engine logs and try again.",
            timestamp: nowLabel(),
            runId: run?.run_id || undefined,
            runStatus: run?.status || undefined,
            error: Boolean(runFailed),
            model: data.model,
            provider: data.provider,
          },
        ]);

        // Only refresh the dashboard when a run was genuinely dispatched.
        if (run?.run_id) onRunTriggered?.();
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        const detail = err?.message || "Network error.";
        setEngineUnavailable(detail);
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: `I could not reach the testing engine: ${detail}`,
            timestamp: nowLabel(),
            error: true,
          },
        ]);
      } finally {
        abortRef.current = null;
        setIsThinking(false);
      }
    },
    [activeRepo, input, isThinking, messages, onRunTriggered, targetUrl]
  );

  if (!isOpen) return null;

  const clearThread = () => {
    setMessages([]);
    setEngineUnavailable(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col h-[600px] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs shrink-0">
              <Bot className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-950">AutoQA AI Copilot</span>
                <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-medium">
                  Live Chat
                </span>
                {lastModel && (
                  <span
                    className="hidden sm:inline text-[10px] font-mono text-slate-400 truncate"
                    title={`Last reply from ${lastModel}`}
                  >
                    {lastModel}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate max-w-[320px]">
                {isExternal ? `🌐 ${cleanName}` : `📦 ${activeRepo || "No project selected"}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                onClick={clearThread}
                title="Clear this conversation"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Chat Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
          {[greeting, ...messages].map((msg) => {
            const isError = Boolean(msg.error);
            return (
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
                      : isError
                        ? "bg-amber-100 text-amber-800 border border-amber-200"
                        : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="h-3.5 w-3.5" />
                  ) : isError ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                </div>

                <div
                  className={`rounded-xl px-3.5 py-2.5 max-w-[82%] text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-slate-900 text-white rounded-tr-none shadow-xs"
                      : isError
                        ? "bg-amber-50 text-amber-900 border border-amber-200 rounded-tl-none shadow-2xs"
                        : "bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-2xs"
                  }`}
                >
                  <MessageBody content={msg.content} />

                  {msg.runId && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span className="font-mono flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        Run {msg.runStatus ? `(${msg.runStatus}) ` : ""}
                        {msg.runId}
                      </span>
                      <button
                        onClick={() => {
                          onClose();
                          window.location.href = runsHref;
                        }}
                        className="text-emerald-700 hover:underline font-semibold cursor-pointer"
                      >
                        View in Runs →
                      </button>
                    </div>
                  )}

                  <div className="text-[9px] mt-1 text-right text-slate-400">
                    {msg.timestamp}
                    {msg.model && msg.role === "assistant" && !isError ? ` · ${msg.model}` : ""}
                  </div>
                </div>
              </div>
            );
          })}

          {isThinking && (
            <div className="flex items-center gap-2.5 text-slate-500 text-xs">
              <div className="h-7 w-7 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 animate-pulse" />
              </div>
              <div className="rounded-xl px-3.5 py-2 bg-white border border-slate-200 text-slate-500 text-xs flex items-center gap-1.5 shadow-2xs">
                <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />
                <span>Reading project data…</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {engineUnavailable && (
          <div className="px-4 py-2 border-t border-amber-200 bg-amber-50 text-[11px] text-amber-900 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="flex-1">{engineUnavailable}</span>
            <button
              onClick={() => setEngineUnavailable(null)}
              className="font-semibold hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Quick Suggestion Pills */}
        <div className="px-4 py-2 border-t border-slate-100 bg-white flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider">
            Suggested:
          </span>
          {quickPrompts.map((qp) => (
            <button
              key={qp}
              onClick={() => handleSendMessage(qp)}
              disabled={isThinking}
              className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors text-[11px] cursor-pointer disabled:opacity-50"
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
            placeholder={
              activeRepo
                ? `Ask AutoQA Copilot about ${cleanName}…`
                : "Import a project to ask about its runs…"
            }
            className="flex-1 px-3.5 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-slate-950 focus:border-transparent transition-all"
          />
          <Button
            type="submit"
            disabled={!input.trim() || isThinking}
            className="h-9 px-4 bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-2xs cursor-pointer gap-1.5 disabled:opacity-50"
          >
            <span>Send</span>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>

        {/* Provenance footer: the answers are model output grounded in the
            project's own rows, and that should be visible to the user. */}
        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50 flex items-center gap-1.5 text-[10px] text-slate-400">
          <Cpu className="h-3 w-3" />
          <span>
            Answers use this project&apos;s saved settings and recorded runs only.
          </span>
          <a
            href={runsHref}
            className="ml-auto inline-flex items-center gap-0.5 hover:text-slate-600"
          >
            Activity &amp; Runs
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
