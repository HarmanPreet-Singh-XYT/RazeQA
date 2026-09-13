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

-- 7. PR-centric model (pull requests, test cases, findings, context, team, usage)
--    Kept in sync with supabase/migrations/20260913000000_pr_centric_model.sql.

create table if not exists pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  pr_number integer not null,
  title text,
  author_login text,
  author_type text not null default 'user',
  state text not null default 'open',
  is_draft boolean not null default false,
  head_branch text,
  base_branch text not null default 'main',
  head_sha text,
  html_url text,
  latest_run_id text references runs(id) on delete set null,
  added_lines integer,
  removed_lines integer,
  changed_files integer,
  opened_at timestamptz,
  tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repo_full_name, pr_number)
);
create index if not exists idx_pull_requests_repo on pull_requests(repo_full_name);
create index if not exists idx_pull_requests_project on pull_requests(project_id);
create index if not exists idx_pull_requests_opened on pull_requests(opened_at desc);

create table if not exists test_cases (
  id uuid primary key default gen_random_uuid(),
  run_id text references runs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  pr_number integer,
  name text not null,
  route text,
  status text not null default 'skipped',
  category text not null default 'happy_path',
  severity text,
  impact text,
  failure_reason text,
  reproduction_steps jsonb not null default '[]'::jsonb,
  code_analysis jsonb not null default '[]'::jsonb,
  mock_context jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  origin text not null default 'new',
  verified_this_commit boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_test_cases_run on test_cases(run_id);
create index if not exists idx_test_cases_project on test_cases(project_id);
create index if not exists idx_test_cases_severity on test_cases(severity);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  fingerprint text not null,
  severity text not null default 'medium',
  category text,
  title text not null,
  detail text,
  route text,
  first_seen_run_id text,
  last_seen_run_id text,
  status text not null default 'open',
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  dismiss_reason text,
  occurrences integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repo_full_name, fingerprint)
);
create index if not exists idx_findings_repo_status on findings(repo_full_name, status);
create index if not exists idx_findings_project on findings(project_id);

create table if not exists project_context (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  kind text not null,
  name text not null,
  value text,
  encrypted boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind, name)
);
create index if not exists idx_project_context_project on project_context(project_id);

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  org_login text not null,
  user_id uuid references auth.users(id) on delete cascade,
  github_login text,
  email text,
  role text not null default 'member',
  seat_assigned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_login, user_id)
);
create index if not exists idx_team_members_org on team_members(org_login);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  quantity integer not null default 1,
  unit_cost_usd numeric(10, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_events_created on usage_events(created_at desc);
create index if not exists idx_usage_events_project on usage_events(project_id);

alter table pull_requests enable row level security;
alter table test_cases enable row level security;
alter table findings enable row level security;
alter table project_context enable row level security;
alter table team_members enable row level security;
alter table usage_events enable row level security;

drop policy if exists "Service role full access on pull_requests" on pull_requests;
drop policy if exists "Service role full access on test_cases" on test_cases;
drop policy if exists "Service role full access on findings" on findings;
drop policy if exists "Service role full access on project_context" on project_context;
drop policy if exists "Service role full access on team_members" on team_members;
drop policy if exists "Service role full access on usage_events" on usage_events;

create policy "Service role full access on pull_requests" on pull_requests for all using (auth.role() = 'service_role');
create policy "Service role full access on test_cases" on test_cases for all using (auth.role() = 'service_role');
create policy "Service role full access on findings" on findings for all using (auth.role() = 'service_role');
create policy "Service role full access on project_context" on project_context for all using (auth.role() = 'service_role');
create policy "Service role full access on team_members" on team_members for all using (auth.role() = 'service_role');
create policy "Service role full access on usage_events" on usage_events for all using (auth.role() = 'service_role');

drop policy if exists "Users can view own pull requests" on pull_requests;
drop policy if exists "Users can view own test cases" on test_cases;
drop policy if exists "Users can view own findings" on findings;
drop policy if exists "Users can view own project context" on project_context;

create policy "Users can view own pull requests" on pull_requests for select using (
  exists (select 1 from projects where projects.id = pull_requests.project_id and projects.user_id = auth.uid())
);
create policy "Users can view own test cases" on test_cases for select using (
  exists (select 1 from projects where projects.id = test_cases.project_id and projects.user_id = auth.uid())
);
create policy "Users can view own findings" on findings for select using (
  exists (select 1 from projects where projects.id = findings.project_id and projects.user_id = auth.uid())
);
create policy "Users can view own project context" on project_context for select using (
  exists (select 1 from projects where projects.id = project_context.project_id and projects.user_id = auth.uid())
);

-- 8. Saved tests (reusable regression suite)
--    Kept in sync with supabase/migrations/20260913000000_pr_centric_model.sql.

create table if not exists saved_tests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  name text not null,
  route text,
  category text not null default 'happy_path',
  intent text,
  preconditions jsonb not null default '[]'::jsonb,
  source_run_id text,
  source_case_id uuid,
  enabled boolean not null default true,
  times_run integer not null default 0,
  last_verified_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repo_full_name, fingerprint)
);
create index if not exists idx_saved_tests_repo on saved_tests(repo_full_name);
create index if not exists idx_saved_tests_project on saved_tests(project_id);
create index if not exists idx_saved_tests_enabled on saved_tests(repo_full_name, enabled);

alter table saved_tests enable row level security;

drop policy if exists "Service role full access on saved_tests" on saved_tests;
create policy "Service role full access on saved_tests" on saved_tests for all using (auth.role() = 'service_role');

drop policy if exists "Users can view own saved tests" on saved_tests;
create policy "Users can view own saved tests" on saved_tests for select using (
  exists (select 1 from projects where projects.id = saved_tests.project_id and projects.user_id = auth.uid())
);
