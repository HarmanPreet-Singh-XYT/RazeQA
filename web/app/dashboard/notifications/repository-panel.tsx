"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Mail, RefreshCw, Send } from "lucide-react";
import { useDashboard } from "@/components/dashboard-context";
import {
  Card,
  ErrorBanner,
  EVENT_ROWS,
  normalizePolicy,
  parseRecipients,
  SaveButton,
  SeverityRow,
  ToggleRow,
  type RepositoryPolicy,
  DEFAULT_POLICY,
} from "./notification-shared";

/**
 * Per-repository notification policy: which events email this repo's watchers,
 * at what severity, and who else to include beyond the resolved team.
 */

interface DeliveryMessage {
  id?: string;
  kind?: string;
  subject?: string;
  recipients?: string[];
  status?: string;
  attempts?: number;
  lastError?: string | null;
  createdAt?: string;
}

interface EmailStatus {
  configured?: boolean;
  active?: boolean;
  host?: string;
  from?: string;
  warning?: string;
  error?: string;
  messages?: DeliveryMessage[];
}

function statusTone(message: DeliveryMessage): string {
  switch (message.status) {
    case "sent":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "failed":
      return "text-rose-700 bg-rose-50 border-rose-200";
    case "skipped":
      return "text-amber-700 bg-amber-50 border-amber-200";
    default:
      return "text-slate-600 bg-slate-50 border-slate-200";
  }
}

export function RepositoryPanel() {
  const { projects, refreshProjects, activeRepo } = useDashboard();
  const gitProjects = useMemo(() => projects.filter((p) => p.type !== "external"), [projects]);

  const [repo, setRepo] = useState(activeRepo || "");
  const [policy, setPolicy] = useState<RepositoryPolicy>(DEFAULT_POLICY);
  const [recipientsText, setRecipientsText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const activeProject = useMemo(
    () => gitProjects.find((p) => p.repo_full_name === repo),
    [gitProjects, repo]
  );

  useEffect(() => {
    if (!repo && gitProjects.length > 0) setRepo(gitProjects[0].repo_full_name);
  }, [gitProjects, repo]);

  useEffect(() => {
    if (activeProject) {
      const next = normalizePolicy(activeProject.settings);
      setPolicy(next);
      setRecipientsText(next.recipients.join(", "));
      setSaved(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, activeProject?.repo_full_name]);

  const loadStatus = useCallback(async () => {
    if (!repo) return;
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/email?repo=${encodeURIComponent(repo)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setStatus(data);
    } catch {
      setStatus({ warning: "Could not reach the AutoQA server." });
    } finally {
      setLoadingStatus(false);
    }
  }, [repo]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const save = async () => {
    if (!repo) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload = { ...policy, recipients: parseRecipients(recipientsText) };
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_full_name: repo, settings: { notifications: payload } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not save notification settings (HTTP ${res.status}).`);
        return;
      }
      await refreshProjects();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Could not reach the AutoQA server.");
    } finally {
      setIsSaving(false);
    }
  };

  const sendTest = async () => {
    if (!repo) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, to: testTo.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestResult({
          ok: false,
          message: data?.detail || data?.error || `Send failed (HTTP ${res.status}).`,
        });
        return;
      }
      setTestResult({
        ok: true,
        message: `Test email sent to ${(data?.recipients || []).join(", ") || "the configured recipients"}.`,
      });
      void loadStatus();
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || "Could not reach the AutoQA server." });
    } finally {
      setTesting(false);
    }
  };

  const toggleEvent = (key: string) =>
    setPolicy((prev) => ({ ...prev, events: { ...prev.events, [key]: !prev.events[key] } }));

  const badgeTone = status?.warning || status?.error
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : status?.active
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer min-w-[260px]"
        >
          <option value="">Select a repository…</option>
          {gitProjects.map((project) => (
            <option key={project.repo_full_name} value={project.repo_full_name}>
              {project.repo_full_name}
            </option>
          ))}
        </select>
        <button
          onClick={loadStatus}
          disabled={!repo || loadingStatus}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingStatus ? "animate-spin" : ""}`} />
          Refresh
        </button>
        {repo && <SaveButton onClick={save} saving={isSaving} saved={saved} />}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className={`rounded-lg border p-3 text-xs flex items-start gap-2 ${badgeTone}`}>
        <Mail className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          {status?.warning || status?.error
            ? status.warning || status.error
            : status?.active
              ? `SMTP is live via ${status?.host || "the configured relay"}${status?.from ? ` (from ${status.from})` : ""}.`
              : "SMTP is not configured. Set SMTP_HOST and SMTP_FROM in agent/.env to enable delivery."}
        </span>
      </div>

      {!repo ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          Import a repository first to configure notifications.
        </p>
      ) : (
        <>
          <Card title="Delivery">
            <ToggleRow
              checked={policy.enabled}
              onChange={() => setPolicy((prev) => ({ ...prev, enabled: !prev.enabled }))}
              label="Email this repository's team"
              blurb="Off silences every notification for this repository, including test sends."
            />
            <div>
              <label className="text-xs font-semibold text-slate-800 block mb-1">
                Additional recipients{" "}
                <span className="font-normal text-slate-400">(optional, comma-separated)</span>
              </label>
              <input
                type="text"
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                placeholder="qa-team@example.com, lead@example.com"
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Added to the team members and project owner the engine resolves automatically.
              </p>
            </div>
          </Card>

          <Card title="What triggers an email">
            {EVENT_ROWS.map((row) => (
              <ToggleRow
                key={row.key}
                checked={policy.events[row.key] !== false}
                onChange={() => toggleEvent(row.key)}
                label={row.label}
                blurb={row.blurb}
              />
            ))}
            <SeverityRow
              value={policy.min_severity}
              onChange={(value) => setPolicy((prev) => ({ ...prev, min_severity: value }))}
              label="Minimum finding severity"
              blurb="Findings below this level are not emailed individually."
            />
          </Card>

          <Card title="Send a test email">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="Leave blank to use NOTIFY_EMAIL_TO"
                className="flex-1 min-w-[240px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <button
                onClick={sendTest}
                disabled={testing || !status?.configured}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {testing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {testing ? "Sending…" : "Send test"}
              </button>
            </div>
            {testResult && (
              <p className={`text-[11px] ${testResult.ok ? "text-emerald-700" : "text-rose-700"}`}>
                {testResult.message}
              </p>
            )}
          </Card>

          <Card title="Recent deliveries">
            {!status?.messages || status.messages.length === 0 ? (
              <p className="text-[11px] text-slate-400">No emails recorded for this repository yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {status.messages.map((message) => (
                  <div key={message.id} className="py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-800 truncate">{message.subject || message.kind}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {(message.recipients || []).join(", ")}
                        {message.createdAt ? ` · ${new Date(message.createdAt).toLocaleString()}` : ""}
                      </p>
                      {message.lastError && (
                        <p className="text-[11px] text-rose-600 truncate">{message.lastError}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${statusTone(message)}`}
                    >
                      {message.status || "unknown"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
