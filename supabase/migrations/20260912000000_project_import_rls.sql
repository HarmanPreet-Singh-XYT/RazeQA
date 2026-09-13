-- Migration: fix project import writes (RLS) and drop the auto-import model
--
-- Why this exists
-- ---------------
-- The dashboard's "Import repository" flow POSTed to /api/projects with the
-- *publishable/anon* key. The `projects` table only had a service-role policy
-- plus a SELECT-own policy, so every import failed with:
--
--   new row violates row-level security policy for table "projects"
--
-- This migration:
--   1. Adds `default_branch` and `imported_at` (both were read/written by the
--      UI but never existed as columns, so branch choices were silently lost).
--   2. Adds owner-scoped INSERT/UPDATE/DELETE policies so an authenticated user
--      can only ever write rows they own. Writes from the dashboard go through
--      the secret key (see web/lib/supabase/admin.ts); these policies are
--      defence in depth so a publishable-key write can never create an
--      unowned or cross-tenant row.
--   3. Backfills ownership/import metadata for existing rows.
--
-- Applying this file is idempotent; it is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Columns the import flow needs
-- ---------------------------------------------------------------------------
alter table projects add column if not exists default_branch text default 'main';
alter table projects
  add column if not exists imported_at timestamptz default now();

-- Existing rows predate explicit imports. Stamp them so "already imported"
-- checks (GET /api/github/repos) are truthful for them too.
update projects set imported_at = created_at where imported_at is null;

-- ---------------------------------------------------------------------------
-- 2. Row level security
-- ---------------------------------------------------------------------------
alter table projects enable row level security;

-- Service role keeps full access (the agent/backend runs with this key).
drop policy if exists "Service role full access on projects" on projects;
create policy "Service role full access on projects" on projects
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Owners can read their own projects.
drop policy if exists "Users can view own projects" on projects;
create policy "Users can view own projects" on projects
  for select
  using (auth.uid() = user_id);

-- Owners can import (insert) projects, but only as themselves. The
-- `with check` is what prevents a caller from writing a row owned by somebody
-- else or leaving user_id null.
drop policy if exists "Users can insert own projects" on projects;
create policy "Users can insert own projects" on projects
  for insert
  with check (auth.uid() = user_id);

-- Owners can update their own projects, and cannot reassign them to another
-- user (the `using` clause pins the existing row, `with check` the new one).
drop policy if exists "Users can update own projects" on projects;
create policy "Users can update own projects" on projects
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Owners can remove their own projects.
drop policy if exists "Users can delete own projects" on projects;
create policy "Users can delete own projects" on projects
  for delete
  using (auth.uid() = user_id);

-- Runs remain readable only for the runs of projects the user owns.
drop policy if exists "Users can view runs for own projects" on runs;
create policy "Users can view runs for own projects" on runs
  for select
  using (
    exists (
      select 1 from projects
      where projects.id = runs.project_id and projects.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Optional cleanup of rows auto-created by the old sync/webhook behaviour
-- ---------------------------------------------------------------------------
-- Previously, POST /api/github/sync and GitHub `installation` webhooks inserted
-- a `projects` row for EVERY repository the App could access, which is why
-- granted repos appeared as already-configured projects. Those inserts no longer
-- happen (see agent/src/agent/api/github.py and agent/src/agent/api/webhooks.py).
--
-- Rows from that behaviour are unowned and have only discovery defaults in
-- `settings` (no `roles` / `testing` key, which the settings UI always writes).
-- They are now harmless but still clutter the project list. Review, then remove
-- with:
--
--   select id, repo_full_name, created_at, settings
--   from projects
--   where user_id is null
--     and not (settings ? 'roles')
--     and not (settings ? 'testing')
--   order by created_at;
--
--   delete from projects
--   where user_id is null
--     and not (settings ? 'roles')
--     and not (settings ? 'testing')
--     and not exists (select 1 from runs where runs.project_id = projects.id);
--
-- The `not exists (runs...)` guard keeps any project that has real run history.
