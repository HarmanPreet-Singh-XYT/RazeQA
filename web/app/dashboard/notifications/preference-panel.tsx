"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  DEFAULT_BLOB,
  ErrorBanner,
  EVENT_ROWS,
  normalizeBlob,
  parseRecipients,
  SaveButton,
  SeverityRow,
  ToggleRow,
  type PolicyBlob,
} from "./notification-shared";

/**
 * Workspace defaults ("applies to my projects") and personal preferences
 * ("applies to me") share one page shape, so they share one component. The only
 * structural difference is that only the workspace default takes extra
 * recipients.
 */

type Mode = "defaults" | "personal";

const COPY: Record<Mode, { title: string; description: string; enabledLabel: string; enabledBlurb: string }> = {
  defaults: {
    title: "Workspace defaults",
    description:
      "Applied to every repository you own that has not saved its own notification policy. Changing a field here reaches those repositories immediately.",
    enabledLabel: "Email my repositories' watchers by default",
    enabledBlurb: "A repository can still override this on the Repositories tab.",
  },
  personal: {
    title: "My preferences",
    description:
      "Applied to you when you are a recipient (as a project owner or team member). This never changes what anyone else receives.",
    enabledLabel: "Email me",
    enabledBlurb: "Turn off to opt yourself out of every notification without silencing the repository.",
  },
};

export function PreferencePanel({ mode }: { mode: Mode }) {
  const [blob, setBlob] = useState<PolicyBlob>({ ...DEFAULT_BLOB });
  const [recipientsText, setRecipientsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/notification-settings", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data?.migration_required) setMigrationRequired(true);
        if (!res.ok && data?.error) setError(data.error);
        const source = mode === "defaults" ? data?.defaults : data?.personal;
        const normalized = normalizeBlob(source);
        setBlob(normalized);
        if (mode === "defaults") {
          const recipients = Array.isArray(source?.recipients) ? source.recipients : [];
          setRecipientsText(recipients.join(", "));
        }
      } catch {
        if (!cancelled) setError("Could not load your notification settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const save = async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    const payload: Record<string, unknown> = { ...blob };
    if (mode === "defaults") payload.recipients = parseRecipients(recipientsText);
    try {
      const res = await fetch("/api/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [mode]: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not save (HTTP ${res.status}).`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Could not reach the AutoQA server.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEvent = (key: string) =>
    setBlob((prev) => ({ ...prev, events: { ...prev.events, [key]: !prev.events[key] } }));

  const copy = COPY[mode];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">{copy.description}</p>
        <SaveButton onClick={save} saving={isSaving} saved={saved} disabled={loading || migrationRequired} />
      </div>

      {error && <ErrorBanner message={error} />}
      {migrationRequired && (
        <ErrorBanner message="Apply supabase/migrations/20260915000000_notification_settings.sql before saving." />
      )}

      <Card title="Delivery">
        <ToggleRow
          checked={blob.enabled}
          onChange={() => setBlob((prev) => ({ ...prev, enabled: !prev.enabled }))}
          label={copy.enabledLabel}
          blurb={copy.enabledBlurb}
        />
        {mode === "defaults" && (
          <div>
            <label className="text-xs font-semibold text-slate-800 block mb-1">
              Global recipients{" "}
              <span className="font-normal text-slate-400">(optional, comma-separated)</span>
            </label>
            <input
              type="text"
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              placeholder="qa-team@example.com"
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Always receive a copy of your repositories&apos; notifications, in addition to team members
              and the project owner.
            </p>
          </div>
        )}
      </Card>

      <Card title="What triggers an email">
        {EVENT_ROWS.map((row) => (
          <ToggleRow
            key={row.key}
            checked={blob.events[row.key] !== false}
            onChange={() => toggleEvent(row.key)}
            label={row.label}
            blurb={row.blurb}
          />
        ))}
        <SeverityRow
          value={blob.min_severity}
          onChange={(value) => setBlob((prev) => ({ ...prev, min_severity: value }))}
          label="Minimum finding severity"
          blurb="Findings below this level are not emailed individually."
        />
      </Card>
    </div>
  );
}
