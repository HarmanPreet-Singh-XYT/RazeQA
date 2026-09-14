/**
 * First-run briefing state.
 *
 * A newly-imported project has never been verified, so the project detail page
 * shows a briefing that asks *how* the first verification should run. The
 * briefing must keep appearing until a run is actually dispatched — and then
 * never again. Two independent records answer "did that happen?":
 *
 * 1. `settings.first_run` on the project (authoritative, survives devices and
 *    is written only after the engine accepted a run), and
 * 2. a `localStorage` marker (a safety net for the moment between dispatch and
 *    the refreshed project list arriving, or when the project write could not
 *    reach the database).
 *
 * Either one is treated as satisfied. Neither is inferred from "the user opened
 * the page", so dismissing the briefing does not count as running the test.
 */

export type FirstRunMode =
  | "full-sweep"
  | "commit-full"
  | "commit-changes"
  | "commit-range";

/**
 * What was asked of the engine for one verification.
 *
 * Used both for the persisted first-run marker and for ordinary on-demand runs
 * dispatched from the project UI, so the two paths describe a run identically.
 */
export interface RunDispatchRecord {
  run_id?: string | null;
  mode: FirstRunMode | string;
  scope: "changed" | "full";
  /** Commit the run was built and tested at, when one was chosen explicitly. */
  sha?: string | null;
  /** Diff base for the "changes only" modes. */
  base_ref?: string | null;
  completed_at: string;
}

/** The persisted form of a dispatch record, stored at `settings.first_run`. */
export type FirstRunRecord = RunDispatchRecord;

/** A commit as returned by `/api/github/commits`. */
export interface CommitOption {
  sha: string;
  message: string;
  message_full?: string;
  author: string;
  date: string | null;
  /** Parent SHAs, newest-first listing's `parents[0]` is the diff base for "only this commit". */
  parents?: string[];
  html_url?: string | null;
}

const STORAGE_PREFIX = "razeqa_first_run:";

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `first_run` record stored on a project's settings, if it is well-formed. */
export function recordedFirstRun(settings: unknown): FirstRunRecord | null {
  if (!isRecord(settings)) return null;
  const record = settings.first_run;
  if (!isRecord(record)) return null;
  // A record without a completion time is a partial write, not evidence a run
  // happened; treat it as absent so the briefing is not silently suppressed.
  if (typeof record.completed_at !== "string" || !record.completed_at) return null;
  return record as FirstRunRecord;
}

export function rememberFirstRun(repo: string, record: FirstRunRecord): void {
  if (typeof window === "undefined" || !repo) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${repo}`, JSON.stringify(record));
  } catch {
    // Private mode / quota: the server record is the real source of truth.
  }
}

export function localFirstRun(repo: string): FirstRunRecord | null {
  if (typeof window === "undefined" || !repo) return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${repo}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.completed_at !== "string") return null;
    return parsed as FirstRunRecord;
  } catch {
    return null;
  }
}

/**
 * Whether this project's first verification has already been dispatched.
 *
 * `settings` is the project's settings blob (may be undefined while loading).
 */
export function firstRunSatisfied(repo: string, settings: unknown): boolean {
  return Boolean(recordedFirstRun(settings) || localFirstRun(repo));
}

/**
 * Record that a first verification was dispatched, durably and locally.
 *
 * Called from whichever entry point actually dispatched the run — the briefing
 * or the everyday run dialog — so "has this project ever been verified?" does
 * not depend on which button the user happened to press.
 */
export async function persistFirstRunRecord(
  repo: string,
  record: RunDispatchRecord,
  modeLabel?: string
): Promise<void> {
  if (!repo) return;

  // Local first: the run is already dispatched, so the marker must survive even
  // if the project write cannot reach the database.
  rememberFirstRun(repo, record);

  try {
    await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo_full_name: repo,
        settings: {
          first_run: { ...record, ...(modeLabel ? { mode_label: modeLabel } : {}) },
        },
      }),
    });
  } catch {
    // Non-fatal: the local marker keeps the briefing from reappearing.
  }
}

/** A human label for a mode, used in the run's persisted record and the UI. */
export const FIRST_RUN_MODE_LABELS: Record<FirstRunMode, string> = {
  "full-sweep": "Full sweep",
  "commit-full": "One commit (full suite)",
  "commit-changes": "Changes in one commit",
  "commit-range": "Changes across a range",
};
