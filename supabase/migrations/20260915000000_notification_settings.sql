-- Migration: per-user notification defaults, personal preferences & team recipients
--
-- Why this exists
-- ---------------
-- The first cut of email notifications stored everything per repository
-- (`projects.settings.notifications`). That left three gaps the dashboard could
-- not close:
--
--   1. no workspace-wide default — a repo with no saved settings silently got
--      hardcoded engine defaults that nobody could change from the UI;
--   2. no personal subscription — a person could not opt out of an event for
--      themselves without silencing the whole repository for everyone;
--   3. no way to manage `team_members`, the primary recipient source, so it was
--      always empty and resolution fell back to the project owner.
--
-- This migration adds the storage for (1) and (2):
--
--   * `notification_settings` is one row per Supabase user holding two blobs:
--       - `defaults`  — workspace defaults applied to every project that has no
--                       override of its own;
--       - `personal`  — that user's own opt-in/out, applied when they are a
--                       resolved recipient (owner or team member).
--     Two blobs, one row, one round trip, and both are additive JSON so they can
--     evolve without another migration.
--
--   * a case-insensitive unique index on `team_members (org_login, email)` so a
--     member can be invited by address before they have a Supabase `user_id`.
--     The existing `unique (org_login, user_id)` cannot deduplicate those rows,
--     because NULLs are distinct in PostgreSQL.
--
-- Applying this file is idempotent; it is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Per-user notification settings
-- ---------------------------------------------------------------------------

create table if not exists notification_settings (
  -- One row per user. The primary key is the user, so an upsert is natural and
  -- a user can never have two conflicting defaults.
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Workspace defaults applied to the user's projects (see
  -- agent/src/agent/projects/notifications.py).
  defaults jsonb not null default '{}'::jsonb,
  -- The user's own subscription: whether/what they personally receive.
  personal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_settings enable row level security;

drop policy if exists "Service role full access on notification_settings" on notification_settings;
create policy "Service role full access on notification_settings" on notification_settings
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Users may read and write only their own row. The dashboard writes through the
-- secret key (service role); these policies are defence in depth so a
-- publishable-key write can never touch another user's preferences.
drop policy if exists "Users manage own notification settings" on notification_settings;
create policy "Users manage own notification settings" on notification_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Team recipients
-- ---------------------------------------------------------------------------

-- Invite/dedupe by address even before the invitee has a Supabase account.
-- `lower(email)` keeps "Dev@Acme.com" and "dev@acme.com" from becoming two rows.
--
-- Note: this assumes no pre-existing rows that are already case-duplicates of
-- each other. `team_members` had no writer before the dashboard's Team tab, so
-- it is expected to be empty; if yours is not, reconcile duplicates first.
create unique index if not exists idx_team_members_org_email
  on team_members (org_login, lower(email))
  where email is not null;

create index if not exists idx_team_members_email on team_members (lower(email));
