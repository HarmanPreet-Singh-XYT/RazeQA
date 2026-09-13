-- Autonomous PR Testing & QA Engine - Supabase Schema
-- Run this in your Supabase SQL Editor or apply via Supabase CLI.
--
-- NOTE ON EXISTING TABLE CONFLICTS:
-- If your Supabase database already has an existing, unrelated table named "projects"
-- (e.g. with text IDs or other columns), choose one of the following before running:
--   Option A (Keep old data):  ALTER TABLE projects RENAME TO legacy_projects;
--   Option B (Clean overwrite): DROP TABLE IF EXISTS intent_logs, runs, installations, projects CASCADE;

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- 1. GitHub App Installations
create table if not exists installations (
  installation_id bigint primary key,
  account_login text not null,
  account_id bigint not null,
  repositories jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Projects (Registered Repositories)
-- A row here means the user explicitly imported the repository. Discovery
-- (GitHub App installations) never creates rows — see
-- supabase/migrations/20260912000000_project_import_rls.sql.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  installation_id bigint references installations(installation_id) on delete set null,
  repo_full_name text not null unique,
  default_branch text default 'main',
  encrypted_test_credentials text,
  imported_at timestamptz default now(),
  settings jsonb default '{"scope": "changed", "test_type": "functional"}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_projects_repo on projects(repo_full_name);

-- 3. Intent Logs (Streamed by Coding Agent Bridge per branch)
create table if not exists intent_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  branch text not null,
  sha text,
  files jsonb not null default '[]'::jsonb,
  action text not null default 'edit',
  prompt_summary text not null,
  reasoning text not null,
  working_dir text,
  created_at timestamptz default now()
);

create index if not exists idx_intent_logs_branch on intent_logs(branch);
create index if not exists idx_intent_logs_created on intent_logs(created_at desc);

-- 4. Test Runs (On-demand and PR Check Runs)
create table if not exists runs (
  id text primary key,
  project_id uuid references projects(id) on delete cascade,
  branch text not null,
  sha text not null,
  scope text not null default 'changed',
  test_type text not null default 'functional',
  status text not null default 'queued',
  result jsonb,
  trace_url text,
  video_url text,
  github_check_run_id bigint,
  github_pr_number integer,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_runs_freshness on runs(branch, sha, scope, test_type);
create index if not exists idx_runs_created on runs(created_at desc);

-- 5. Row Level Security (RLS) policies
alter table installations enable row level security;
alter table projects enable row level security;
alter table intent_logs enable row level security;
alter table runs enable row level security;

-- Drop existing policies if any to allow idempotent re-runs
drop policy if exists "Service role full access on installations" on installations;
drop policy if exists "Service role full access on projects" on projects;
drop policy if exists "Service role full access on intent_logs" on intent_logs;
drop policy if exists "Service role full access on runs" on runs;
drop policy if exists "Users can view own projects" on projects;
drop policy if exists "Users can insert own projects" on projects;
drop policy if exists "Users can update own projects" on projects;
drop policy if exists "Users can delete own projects" on projects;
drop policy if exists "Users can view runs for own projects" on runs;

-- Service role has full access
create policy "Service role full access on installations" on installations for all using (auth.role() = 'service_role');
create policy "Service role full access on projects" on projects for all using (auth.role() = 'service_role');
create policy "Service role full access on intent_logs" on intent_logs for all using (auth.role() = 'service_role');
create policy "Service role full access on runs" on runs for all using (auth.role() = 'service_role');

-- Authenticated users can view their own projects and runs
create policy "Users can view own projects" on projects for select using (auth.uid() = user_id);
create policy "Users can view runs for own projects" on runs for select using (
  exists (select 1 from projects where projects.id = runs.project_id and projects.user_id = auth.uid())
);

-- Owners may import/update/delete their own projects (see
-- supabase/migrations/20260912000000_project_import_rls.sql). The dashboard
-- writes through the secret key; these policies are defence in depth so a
-- publishable-key write can never create an unowned or cross-tenant row.
create policy "Users can insert own projects" on projects for insert with check (auth.uid() = user_id);
create policy "Users can update own projects" on projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own projects" on projects for delete using (auth.uid() = user_id);

-- 6. Storage Bucket for Forensic Run Artifacts (Videos, Traces, Screenshots)
insert into storage.buckets (id, name, public)
values ('run-artifacts', 'run-artifacts', false)
on conflict (id) do update set public = false;

-- Service role can upload, manage, and sign URLs for run artifacts
drop policy if exists "Service Role Manage Run Artifacts" on storage.objects;
create policy "Service Role Manage Run Artifacts"
on storage.objects for all
using ( bucket_id = 'run-artifacts' and auth.role() = 'service_role' );


