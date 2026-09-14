"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Bot,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Send,
  Square,
  Sparkles,
  FolderGit2,
  Globe,
  Copy,
  Cpu,
  Eye,
  ShieldCheck,
  Zap,
  ShieldAlert,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Gauge,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/components/dashboard-context";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/prompt-kit/chat-container";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageAction,
  MessageActions,
} from "@/components/prompt-kit/message";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";
import { Loader } from "@/components/prompt-kit/loader";
import { ThinkingBar } from "@/components/prompt-kit/thinking-bar";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import { FeedbackBar } from "@/components/prompt-kit/feedback-bar";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import { Tool, type ToolPart } from "@/components/prompt-kit/tool";
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/prompt-kit/steps";
import { cn } from "@/lib/utils";

/**
 * A tool the agent chose to call while answering. Mirrors the engine's
 * `ToolCallTrace`; the UI shows it so the answer's provenance is visible.
 */
interface ToolCall {
  name: string;
  status: "ok" | "error" | "denied" | "pending_approval";
  input?: Record<string, unknown>;
  summary?: string;
}

/** A write action the agent stopped short of, awaiting the user's approval. */
interface PendingApproval {
  action_id: string;
  tool: string;
  input?: Record<string, unknown>;
  summary?: string;
  risk?: "write" | "external";
}

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
  toolCalls?: ToolCall[];
  stepsUsed?: number;
  maxToolCalls?: number;
}

type AgentMode = "read_only" | "standard" | "autonomous";
type FeedbackChoice = "up" | "down" | null;

interface HealthProvider {
  id: string;
  label: string;
  available: boolean;
}

/** How many prior turns are sent back as conversation context. */
const HISTORY_WINDOW = 8;

const COPILOT_AVATAR = "/copilot-avatar.svg";

const MODES: { id: AgentMode; label: string; icon: typeof Eye; blurb: string }[] = [
  {
    id: "read_only",
    label: "Read-only",
    icon: Eye,
    blurb: "Inspect runs, findings, PRs, and analytics. Nothing changes.",
  },
  {
    id: "standard",
    label: "Standard",
    icon: ShieldCheck,
    blurb: "Reads, triage, and dispatching a run. Applying a fix or commenting on a PR asks first.",
  },
  {
    id: "autonomous",
    label: "Autonomous",
    icon: Zap,
    blurb: "Everything the agent can do, without asking. Still fully traced.",
  },
];

const SETTINGS_KEY = "autoqa_copilot_settings_v1";

interface CopilotSettings {
  mode: AgentMode;
  provider: string;
  scope: "changed" | "full";
  testType: "functional" | "exploratory";
  maxToolCalls: number;
}

const DEFAULT_SETTINGS: CopilotSettings = {
  mode: "standard",
  provider: "",
  scope: "changed",
  testType: "functional",
  maxToolCalls: 8,
};

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function threadKey(repo: string | null | undefined): string {
  return `autoqa_copilot_thread_${repo || "workspace"}`;
}

function initials(email: string | null): string {
  if (!email) return "ME";
  return email.slice(0, 2).toUpperCase();
}

/**
 * Feedback is recorded through the existing telemetry sink. It is deliberately
 * fire-and-forget: a failed beacon must never interrupt the conversation.
 */
function recordFeedback(name: "copilot-helpful" | "copilot-not-helpful") {
  try {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "feedback", name, url: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry is best-effort.
  }
}

/**
 * Map an engine tool trace onto prompt-kit's `ToolPart` so the agent's steps
 * render with the same component used for tool calls elsewhere.
 */
function toToolPart(call: ToolCall, index: number): ToolPart {
  const failed = call.status !== "ok";
  return {
    type: call.name,
    state: failed ? "output-error" : "output-available",
    input: call.input ?? {},
    output: call.summary ? { summary: call.summary } : undefined,
    toolCallId: `${call.name}-${index}`,
    errorText:
      call.status === "denied" || call.status === "pending_approval"
        ? call.summary
        : undefined,
  };
}

function loadSettings(): CopilotSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      mode: MODES.some((m) => m.id === parsed?.mode) ? parsed.mode : DEFAULT_SETTINGS.mode,
      provider: typeof parsed?.provider === "string" ? parsed.provider : "",
      scope: parsed?.scope === "full" ? "full" : "changed",
      testType: parsed?.testType === "exploratory" ? "exploratory" : "functional",
      maxToolCalls:
        Number.isFinite(parsed?.maxToolCalls) && parsed.maxToolCalls >= 1
          ? Math.min(20, Math.round(parsed.maxToolCalls))
          : DEFAULT_SETTINGS.maxToolCalls,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function AgentChatClient({ userEmail }: { userEmail: string | null }) {
  const searchParams = useSearchParams();
  const { activeRepo, projects } = useDashboard();

  const urlRepo = searchParams ? searchParams.get("repo") : null;
  const repo = urlRepo || activeRepo || projects[0]?.repo_full_name || "";
  const isExternal = Boolean(repo.startsWith("external:"));

  const displayName = useMemo(() => {
    if (!repo) return "Workspace";
    const raw = isExternal ? repo.replace("external:", "") : repo.split("/")[1] || repo;
    return raw || "Workspace";
  }, [repo, isExternal]);

  const targetUrl = projects.find((p) => p.repo_full_name === repo)?.domain || null;
  const runsHref = repo
    ? `/dashboard/runs?repo=${encodeURIComponent(repo)}`
    : "/dashboard/runs";

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackChoice>(null);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [lastUserText, setLastUserText] = useState("");
  const [settings, setSettings] = useState<CopilotSettings>(DEFAULT_SETTINGS);
  const [providers, setProviders] = useState<HealthProvider[]>([]);
  const [railRuns, setRailRuns] = useState<
    { run_id: string; status: string; branch: string; created_at: string }[]
  >([]);

  const abortRef = useRef<AbortController | null>(null);
  const storageKey = threadKey(repo);

  const updateSettings = useCallback((patch: Partial<CopilotSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: the setting still applies for this session.
      }
      return next;
    });
  }, []);

  // Load persisted controls and the persisted thread for this project.
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/copilot", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.providers)) {
          setProviders(data.providers.filter((p: HealthProvider) => p.available));
        }
      } catch {
        // The picker simply stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          setFeedback(null);
          setPending([]);
          return;
        }
      }
    } catch {
      // Corrupt or unavailable storage: start a clean thread.
    }
    setMessages([]);
    setFeedback(null);
    setPending([]);
  }, [storageKey]);

  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      // Storage full or blocked: the conversation still works in-memory.
    }
  }, [messages, storageKey]);

  // Context rail: the same run history the engine sees, so the panel can never
  // disagree with the transcript.
  useEffect(() => {
    let cancelled = false;
    if (!repo) {
      setRailRuns([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/runs?repo=${encodeURIComponent(repo)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data) ? data : data.runs || [];
        if (!cancelled) setRailRuns(rows.slice(0, 6));
      } catch {
        // The rail is supplementary; a failure leaves it quiet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const greeting = useMemo<ChatMessage>(
    () => ({
      id: "greeting",
      role: "assistant",
      // No timestamp: `toLocaleTimeString` differs between the server render and
      // the client, which is a hydration mismatch. Every other turn is created
      // in an event handler, so it is client-only.
      content: isExternal
        ? `Hello! I am your AutoQA AI Copilot for **${displayName}** (external website). I can explain recent verification runs, check route and HTTP findings, or audit this site.\n\nWhat would you like to look at?`
        : `Hello! I am your AutoQA AI Copilot for **${displayName}**. I can read runs, findings, pull requests, commits, and analytics — and act on them when you ask.\n\nWhat would you like to know?`,
      timestamp: "",
    }),
    [displayName, isExternal]
  );

  const quickPrompts = isExternal
    ? [
        "How is the external website performing?",
        "Audit this site now",
        "Check HTTP response codes & SSL",
      ]
    : [
        "What is the status of my latest test run?",
        "What keeps failing, and why?",
        "Compare the last two runs",
        "Trigger verification on the active branch",
      ];

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsThinking(false);
  }, []);

  const sendTurn = useCallback(
    async (
      messageText: string,
      options: { approvals?: string[]; appendUser?: boolean } = {}
    ) => {
      const text = messageText.trim();
      if (!text || isThinking) return;

      const appendUser = options.appendUser !== false;
      const approvals = options.approvals ?? [];

      const historySource = [...messages].filter((m) => m.id !== "greeting");
      // When replaying an approved turn, the user message is already in the
      // thread and is sent as `message` again — drop it from history so the
      // model does not see the same turn twice.
      if (!appendUser && historySource.length > 0) {
        const last = historySource[historySource.length - 1];
        if (last.role === "user" && last.content.trim() === text) historySource.pop();
      }
      const history = historySource
        .slice(-HISTORY_WINDOW)
        .map((m) => ({ role: m.role, content: m.content }));

      if (appendUser) {
        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: "user",
          content: text,
          timestamp: nowLabel(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setLastUserText(text);
        setInput("");
      }

      setIsThinking(true);
      setEngineError(null);
      setFeedback(null);
      setPending([]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: text,
            history,
            repo_full_name: repo,
            branch: "main",
            allow_trigger: true,
            target_url: targetUrl || undefined,
            mode: settings.mode,
            provider: settings.provider || undefined,
            scope: settings.scope,
            test_type: settings.testType,
            max_tool_calls: settings.maxToolCalls,
            approvals,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const detail = data.error || `Copilot request failed (HTTP ${res.status}).`;
          setEngineError(detail);
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              content: `I could not complete that: ${detail}`,
              timestamp: nowLabel(),
              error: true,
            },
          ]);
          return;
        }

        setLastModel(data.model || null);
        setPending(Array.isArray(data.pending_approvals) ? data.pending_approvals : []);

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
            toolCalls: Array.isArray(data.tool_calls) ? data.tool_calls : undefined,
            stepsUsed: data.steps_used,
            maxToolCalls: data.max_tool_calls,
          },
        ]);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const detail = err instanceof Error ? err.message : "Network error.";
        setEngineError(detail);
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: `I could not complete that: ${detail}`,
            timestamp: nowLabel(),
            error: true,
          },
        ]);
      } finally {
        abortRef.current = null;
        setIsThinking(false);
      }
    },
    [isThinking, messages, repo, settings, targetUrl]
  );

  const approve = useCallback(() => {
    const ids = pending.map((p) => p.action_id);
    if (ids.length === 0) return;
    void sendTurn(lastUserText, { approvals: ids, appendUser: false });
  }, [lastUserText, pending, sendTurn]);

  const deny = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      {
        id: `denied-${Date.now()}`,
        role: "assistant",
        content: "Understood — I did not take that action.",
        timestamp: nowLabel(),
      },
    ]);
    setPending([]);
  }, []);

  const clearThread = useCallback(() => {
    setMessages([]);
    setEngineError(null);
    setFeedback(null);
    setPending([]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Storage unavailable: the in-memory thread is still cleared.
    }
  }, [storageKey]);

  const thread = useMemo(() => [greeting, ...messages], [greeting, messages]);
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant" && !messages[i].error) return messages[i].id;
    }
    return null;
  }, [messages]);

  const activeMode = MODES.find((m) => m.id === settings.mode) ?? MODES[1];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] w-full bg-background">
      {/* ---------------- chat column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Bot className="size-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold text-foreground">AutoQA Copilot</h1>
                {lastModel && (
                  <span
                    className="hidden rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground sm:inline"
                    title={`Last reply from ${lastModel}`}
                  >
                    {lastModel}
                  </span>
                )}
              </div>
              <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                {isExternal ? (
                  <Globe className="size-3 shrink-0 text-sky-600" />
                ) : (
                  <FolderGit2 className="size-3 shrink-0" />
                )}
                <span className="truncate">{isExternal ? displayName : repo || "No project selected"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={runsHref} />}
            >
              <ExternalLink className="size-3.5" />
              <span>Runs</span>
            </Button>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearThread} title="Clear this conversation">
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
            )}
          </div>
        </header>

        <ChatContainerRoot className="relative min-h-0 flex-1">
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            <SystemMessage
              variant="action"
              fill
              icon={<Sparkles className="size-4" />}
              className="text-xs"
            >
              {activeMode.label} mode — {activeMode.blurb}
            </SystemMessage>

            {thread.map((msg) => {
              const isUser = msg.role === "user";
              const isError = Boolean(msg.error);

              return (
                <Message key={msg.id} className={cn("items-start", isUser && "flex-row-reverse")}>
                  {isUser ? (
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback>{initials(userEmail)}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <MessageAvatar
                      src={COPILOT_AVATAR}
                      alt="AutoQA Copilot"
                      fallback="QA"
                      className={cn(isError && "ring-1 ring-amber-300")}
                    />
                  )}

                  <div
                    className={cn(
                      "flex min-w-0 flex-1 flex-col gap-1.5",
                      isUser ? "items-end" : "items-start"
                    )}
                  >
                    {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="w-full space-y-1">
                        {msg.toolCalls.map((call, index) => (
                          <Tool key={`${msg.id}-tool-${index}`} toolPart={toToolPart(call, index)} />
                        ))}
                      </div>
                    )}

                    <MessageContent
                      markdown={!isUser}
                      className={cn(
                        "max-w-full text-sm leading-relaxed",
                        isUser
                          ? "bg-slate-950 text-white"
                          : "bg-secondary text-secondary-foreground",
                        isError && "border border-amber-300 bg-amber-50 text-amber-900"
                      )}
                    >
                      {msg.content}
                    </MessageContent>

                    {msg.runId && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1 font-mono">
                          <CheckCircle2 className="size-3 text-emerald-600" />
                          Run {msg.runStatus ? `(${msg.runStatus}) ` : ""}
                          {msg.runId}
                        </span>
                        <Link href={runsHref} className="font-semibold text-primary hover:underline">
                          Open in Runs →
                        </Link>
                      </div>
                    )}

                    <MessageActions className="text-[10px]">
                      <span className="text-muted-foreground">
                        {msg.timestamp}
                        {msg.model && !isUser && !isError ? ` · ${msg.model}` : ""}
                        {!isUser && msg.stepsUsed
                          ? ` · ${msg.stepsUsed}/${msg.maxToolCalls ?? settings.maxToolCalls} tools`
                          : ""}
                      </span>
                      {!isUser && !isError && (
                        <MessageAction tooltip="Copy answer">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              void navigator.clipboard?.writeText(msg.content).catch(() => {});
                            }}
                          >
                            <Copy className="size-3" />
                          </Button>
                        </MessageAction>
                      )}
                    </MessageActions>

                    {msg.id === lastAssistantId && feedback === null && (
                      <FeedbackBar
                        className="mt-1"
                        title="Was this answer helpful?"
                        icon={<Cpu className="size-4 text-muted-foreground" />}
                        onHelpful={() => {
                          setFeedback("up");
                          recordFeedback("copilot-helpful");
                        }}
                        onNotHelpful={() => {
                          setFeedback("down");
                          recordFeedback("copilot-not-helpful");
                        }}
                        onClose={() => setFeedback("down")}
                      />
                    )}
                  </div>
                </Message>
              );
            })}

            {pending.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3.5">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-amber-900">
                      {pending.length === 1
                        ? "This action needs your approval"
                        : `${pending.length} actions need your approval`}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {pending.map((action) => (
                        <li key={action.action_id} className="text-[11px] text-amber-900">
                          <span className="font-mono">{action.tool}</span>
                          {action.summary ? ` — ${action.summary}` : ""}
                          {action.risk === "external" ? " (reaches an external service)" : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[10px] text-amber-800/80">
                      Nothing has happened yet. Approving replays this turn with the action permitted.
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Button size="sm" onClick={approve} disabled={isThinking}>
                        <ThumbsUp className="size-3.5" />
                        <span>Approve</span>
                      </Button>
                      <Button variant="outline" size="sm" onClick={deny} disabled={isThinking}>
                        <ThumbsDown className="size-3.5" />
                        <span>Deny</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isThinking && (
              <div className="flex items-start gap-3">
                <MessageAvatar src={COPILOT_AVATAR} alt="AutoQA Copilot" fallback="QA" />
                <div className="min-w-0 flex-1 space-y-2">
                  <ThinkingBar text="Working…" onStop={stop} stopLabel="Stop generating" />
                  <Steps defaultOpen>
                    <StepsTrigger leftIcon={<Loader variant="pulse-dot" size="sm" />}>
                      Agent loop · up to {settings.maxToolCalls} tool calls
                    </StepsTrigger>
                    <StepsContent>
                      <StepsItem>Reading the active project and session mode</StepsItem>
                      <StepsItem>Choosing tools — runs, findings, PRs, analytics, commits</StepsItem>
                      <StepsItem>Pausing for approval before any gated action</StepsItem>
                    </StepsContent>
                  </Steps>
                </div>
              </div>
            )}

            <ChatContainerScrollAnchor />
          </ChatContainerContent>

          <div className="pointer-events-none sticky bottom-4 z-10 flex justify-center">
            <div className="pointer-events-auto">
              <ScrollButton />
            </div>
          </div>
        </ChatContainerRoot>

        <div className="border-t border-border bg-background px-4 pt-3 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {engineError && (
              <SystemMessage
                variant="error"
                fill
                className="text-xs"
                cta={{ label: "Dismiss", variant: "ghost", onClick: () => setEngineError(null) }}
              >
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{engineError}</span>
                </span>
              </SystemMessage>
            )}

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <PromptSuggestion
                    key={prompt}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    disabled={isThinking || !repo}
                    onClick={() => sendTurn(prompt)}
                  >
                    {prompt}
                  </PromptSuggestion>
                ))}
              </div>
            )}

            {/* Session controls sit outside PromptInput: the wrapper focuses
                the textarea on click, which would fight the dropdowns. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SessionControls
                settings={settings}
                providers={providers}
                onChange={updateSettings}
                disabled={isThinking}
              />
              {pending.length > 0 && (
                <span className="text-[10px] font-medium text-amber-700">
                  {pending.length} action{pending.length === 1 ? "" : "s"} awaiting approval
                </span>
              )}
            </div>

            <PromptInput
              value={input}
              onValueChange={setInput}
              onSubmit={() => sendTurn(input)}
              isLoading={isThinking}
              maxHeight={200}
              className="rounded-2xl"
            >
              <PromptInputTextarea
                placeholder={repo ? `Ask about ${displayName}…` : "Import a project to ask about its runs…"}
                disabled={!repo}
              />
              <PromptInputActions className="justify-end px-1 pt-1">
                <PromptInputAction tooltip={isThinking ? "Stop" : "Send"}>
                  <Button
                    size="icon-sm"
                    className="rounded-full"
                    disabled={isThinking ? false : !input.trim() || !repo}
                    onClick={() => (isThinking ? stop() : sendTurn(input))}
                  >
                    {isThinking ? <Square className="size-3.5" /> : <Send className="size-3.5" />}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </PromptInput>

            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Cpu className="size-3" />
              <span>
                Enter sends · Shift+Enter adds a line. Every tool call is shown above the answer.
              </span>
              {repo && (
                <Link
                  href={runsHref}
                  className="ml-auto inline-flex items-center gap-0.5 hover:text-foreground"
                >
                  Activity &amp; Runs
                  <ExternalLink className="size-2.5" />
                </Link>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- context rail ---------------- */}
      <ContextRail
        repo={repo}
        displayName={displayName}
        isExternal={isExternal}
        targetUrl={targetUrl}
        runs={railRuns}
        settings={settings}
      />
    </div>
  );
}

/** The composer's control strip: mode, scope, budget, and provider. */
function SessionControls({
  settings,
  providers,
  onChange,
  disabled,
}: {
  settings: CopilotSettings;
  providers: HealthProvider[];
  onChange: (patch: Partial<CopilotSettings>) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex items-center rounded-full border border-border bg-muted/40 p-0.5">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = settings.mode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              title={mode.blurb}
              disabled={disabled}
              onClick={() => onChange({ mode: mode.id })}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                active
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3" />
              <span className="hidden sm:inline">{mode.label}</span>
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
        <Gauge className="size-3" />
        <span className="sr-only">Tool budget</span>
        <select
          value={settings.maxToolCalls}
          disabled={disabled}
          onChange={(e) => onChange({ maxToolCalls: Number(e.target.value) })}
          className="cursor-pointer bg-transparent text-[11px] text-foreground outline-none disabled:opacity-50"
          title="Maximum tool calls per turn"
        >
          {[4, 8, 12, 16].map((n) => (
            <option key={n} value={n}>
              {n} tools
            </option>
          ))}
        </select>
      </label>

      <select
        value={settings.scope}
        disabled={disabled}
        onChange={(e) => onChange({ scope: e.target.value as "changed" | "full" })}
        className="cursor-pointer rounded-full border border-border bg-transparent px-2 py-1 text-[11px] text-muted-foreground outline-none disabled:opacity-50"
        title="Default scope when the agent dispatches a run"
      >
        <option value="changed">Changed only</option>
        <option value="full">Full suite</option>
      </select>

      {providers.length > 0 && (
        <select
          value={settings.provider}
          disabled={disabled}
          onChange={(e) => onChange({ provider: e.target.value })}
          className="cursor-pointer rounded-full border border-border bg-transparent px-2 py-1 text-[11px] text-muted-foreground outline-none disabled:opacity-50"
          title="Reasoning model provider"
        >
          <option value="">Auto model</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** The right-hand project panel: identity plus the run history the agent sees. */
function ContextRail({
  repo,
  displayName,
  isExternal,
  targetUrl,
  runs,
  settings,
}: {
  repo: string;
  displayName: string;
  isExternal: boolean;
  targetUrl: string | null;
  runs: { run_id: string; status: string; branch: string; created_at: string }[];
  settings: CopilotSettings;
}) {
  const statusTone = (status: string) => {
    const s = (status || "").toLowerCase();
    if (["completed", "passed", "success"].includes(s)) return "bg-emerald-500";
    if (["failed", "failure", "error"].includes(s)) return "bg-rose-500";
    if (["running", "queued"].includes(s)) return "bg-sky-500";
    return "bg-slate-400";
  };

  return (
    <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-muted/20 p-4 xl:flex">
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Active project
        </h2>
        <div className="mt-2 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            {isExternal ? (
              <Globe className="size-4 shrink-0 text-sky-600" />
            ) : (
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-xs font-semibold text-foreground">{displayName}</span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {isExternal ? targetUrl || "no target url" : repo || "none selected"}
          </p>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent runs
          </h2>
          {repo && (
            <Link
              href={`/dashboard/runs?repo=${encodeURIComponent(repo)}`}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              All
            </Link>
          )}
        </div>
        <div className="mt-2 space-y-1">
          {runs.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No runs recorded yet.</p>
          )}
          {runs.map((run) => (
            <Link
              key={run.run_id}
              href={`/dashboard/runs?repo=${encodeURIComponent(repo)}`}
              className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-card"
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", statusTone(run.status))} />
              <span className="truncate font-mono text-[10px] text-foreground">{run.run_id}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {run.branch || "—"}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Session
        </h2>
        <dl className="mt-2 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Mode</dt>
            <dd className="font-medium text-foreground">
              {MODES.find((m) => m.id === settings.mode)?.label}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Run scope</dt>
            <dd className="font-medium text-foreground">
              {settings.scope === "full" ? "Full suite" : "Changed only"}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Tool budget</dt>
            <dd className="font-medium text-foreground">{settings.maxToolCalls} / turn</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="font-medium text-foreground">{settings.provider || "Auto"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The copilot reads and acts through the testing engine. Gated actions always ask
            first unless you are in Autonomous mode.
          </p>
        </div>
      </section>
    </aside>
  );
}
