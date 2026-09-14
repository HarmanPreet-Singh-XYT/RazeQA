"use client";

import React from "react";
import { Check, RefreshCw } from "lucide-react";

/** Shared types, defaults and small presentational pieces for the notification tabs. */

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const EVENT_ROWS: { key: string; label: string; blurb: string }[] = [
  {
    key: "run_completed",
    label: "Verification finished",
    blurb: "Every completed run, with its pass/fail summary. Turn off to hear only about problems.",
  },
  {
    key: "findings_alert",
    label: "New high-severity findings",
    blurb: "A run that produced findings at or above the severity floor below.",
  },
  {
    key: "review_completed",
    label: "Code review finished",
    blurb: "A finished three-lane review and its finding counts.",
  },
  {
    key: "fix_published",
    label: "Verified fix published",
    blurb: "When a verified fix becomes a branch or pull request for review.",
  },
];

export const DEFAULT_EVENTS: Record<string, boolean> = {
  run_completed: true,
  findings_alert: true,
  review_completed: true,
  fix_published: true,
};

export interface PolicyBlob {
  enabled: boolean;
  events: Record<string, boolean>;
  min_severity: string;
}

export interface RepositoryPolicy extends PolicyBlob {
  recipients: string[];
}

export const DEFAULT_POLICY: RepositoryPolicy = {
  enabled: true,
  recipients: [],
  events: { ...DEFAULT_EVENTS },
  min_severity: "high",
};

export const DEFAULT_BLOB: PolicyBlob = {
  enabled: true,
  events: { ...DEFAULT_EVENTS },
  min_severity: "high",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEvents(raw: unknown): Record<string, boolean> {
  const events = { ...DEFAULT_EVENTS };
  if (isObject(raw)) {
    for (const key of Object.keys(events)) {
      if (key in raw) events[key] = raw[key] !== false;
    }
  }
  return events;
}

export function normalizeBlob(raw: unknown): PolicyBlob {
  if (!isObject(raw)) return { ...DEFAULT_BLOB, events: { ...DEFAULT_EVENTS } };
  return {
    enabled: raw.enabled !== false,
    events: normalizeEvents(raw.events),
    min_severity: (SEVERITIES as readonly string[]).includes(String(raw.min_severity))
      ? String(raw.min_severity)
      : "high",
  };
}

export function normalizePolicy(settings: unknown): RepositoryPolicy {
  const container = isObject(settings) ? settings.notifications : undefined;
  const base = normalizeBlob(container);
  const rawRecipients = isObject(container) ? container.recipients : undefined;
  const recipients = Array.isArray(rawRecipients)
    ? rawRecipients.map((r) => String(r)).filter(Boolean)
    : typeof rawRecipients === "string"
      ? rawRecipients.split(/[,;\s]+/).filter(Boolean)
      : [];
  return { ...base, recipients };
}

export function parseRecipients(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of text.split(/[,;\n]+/)) {
    const address = chunk.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

export function labelForSeverity(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : "High";
}

/** A bordered settings block. */
export function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {description && <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** A label + blurb row with a checkbox on the right. */
export function ToggleRow({
  checked,
  onChange,
  label,
  blurb,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  blurb: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50/70">
      <div>
        <span className="text-xs font-semibold text-slate-800 block">{label}</span>
        <span className="text-[11px] text-slate-500">{blurb}</span>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
      />
    </label>
  );
}

/** A label + blurb row with a severity `<select>`. */
export function SeverityRow({
  value,
  onChange,
  label,
  blurb,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  blurb: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3">
      <div>
        <span className="text-xs font-semibold text-slate-800 block">{label}</span>
        <span className="text-[11px] text-slate-500">{blurb}</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 cursor-pointer"
      >
        {SEVERITIES.map((severity) => (
          <option key={severity} value={severity}>
            {labelForSeverity(severity)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SaveButton({
  onClick,
  saving,
  saved,
  disabled,
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
    >
      {saving ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : saved ? (
        <Check className="h-3.5 w-3.5" />
      ) : null}
      {saved ? "Saved" : saving ? "Saving…" : "Save changes"}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
      {message}
    </div>
  );
}
