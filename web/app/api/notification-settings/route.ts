import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";

/**
 * Per-user notification settings: workspace defaults and personal preferences.
 *
 * One row per user in `notification_settings` holds two additive blobs:
 *   - `defaults`  — applied to the user's projects that have no override;
 *   - `personal`  — applied when the user is a resolved recipient.
 *
 * The engine reads this table directly when it composes a notification; this
 * route is the only writer, always scoped to the signed-in user. Only known
 * fields are persisted, so a hand-crafted body cannot inject arbitrary JSON into
 * the blob the engine later reads.
 */

export const dynamic = "force-dynamic";

const EVENTS = [
  "run_completed",
  "findings_alert",
  "review_completed",
  "fix_published",
] as const;
const SEVERITIES = ["critical", "high", "medium", "low"];

interface SanitizedSettings {
  enabled?: boolean;
  events?: Record<string, boolean>;
  min_severity?: string;
  recipients?: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep only recognised fields, normalising types; never store anything else. */
function sanitize(input: unknown, { allowRecipients }: { allowRecipients: boolean }): SanitizedSettings {
  const out: SanitizedSettings = {};
  if (!isPlainObject(input)) return out;

  if (typeof input.enabled === "boolean") out.enabled = input.enabled;

  if (isPlainObject(input.events)) {
    const events: Record<string, boolean> = {};
    for (const key of EVENTS) {
      if (key in input.events) events[key] = Boolean(input.events[key]);
    }
    out.events = events;
  }

  if (typeof input.min_severity === "string" && SEVERITIES.includes(input.min_severity)) {
    out.min_severity = input.min_severity;
  }

  if (allowRecipients && Array.isArray(input.recipients)) {
    out.recipients = Array.from(
      new Set(
        input.recipients
          .map((value) => String(value).trim())
          .filter(Boolean)
      )
    ).slice(0, 50);
  }

  return out;
}

/** The stored blob nests under `notifications`; the API speaks the inner shape. */
function unwrapDefaults(raw: unknown): SanitizedSettings {
  if (!isPlainObject(raw)) return {};
  const inner = raw.notifications;
  return isPlainObject(inner) ? (inner as SanitizedSettings) : {};
}

function missingTable(message: string | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message || "");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notification_settings")
    .select("defaults, personal")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (missingTable(error.message)) {
      return NextResponse.json({
        defaults: {},
        personal: {},
        migration_required: true,
        error:
          "The notification_settings table is not present yet. Apply supabase/migrations/20260915000000_notification_settings.sql.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    defaults: unwrapDefaults(data?.defaults),
    personal: isPlainObject(data?.personal) ? data?.personal : {},
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { defaults?: unknown; personal?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Read first so an unsent blob is preserved and the nested defaults blob
  // keeps any keys this route does not know about.
  const { data: existing, error: readError } = await admin
    .from("notification_settings")
    .select("defaults, personal")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError && !missingTable(readError.message)) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const existingDefaults = isPlainObject(existing?.defaults) ? existing!.defaults : {};
  const existingNotifications = unwrapDefaults(existingDefaults);
  const existingPersonal = isPlainObject(existing?.personal) ? existing!.personal : {};

  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };

  if (body.defaults !== undefined) {
    const sanitized = sanitize(body.defaults, { allowRecipients: true });
    patch.defaults = {
      ...existingDefaults,
      notifications: { ...existingNotifications, ...sanitized },
    };
  }
  if (body.personal !== undefined) {
    const sanitized = sanitize(body.personal, { allowRecipients: false });
    patch.personal = { ...existingPersonal, ...sanitized };
  }

  if (body.defaults === undefined && body.personal === undefined) {
    return NextResponse.json({ error: "Supply defaults and/or personal." }, { status: 400 });
  }

  const { error } = await admin
    .from("notification_settings")
    .upsert(patch, { onConflict: "user_id" });

  if (error) {
    if (missingTable(error.message)) {
      return NextResponse.json(
        {
          error:
            "The notification_settings table is not present yet. Apply supabase/migrations/20260915000000_notification_settings.sql.",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data } = await admin
    .from("notification_settings")
    .select("defaults, personal")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    status: "saved",
    defaults: unwrapDefaults(data?.defaults),
    personal: isPlainObject(data?.personal) ? data?.personal : {},
  });
}
