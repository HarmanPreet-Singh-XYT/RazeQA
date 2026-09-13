-- PR-centric model: pull requests, structured test cases, dismissible findings,
-- per-repository context, team roles, and usage metering.
--
-- Everything here is additive and idempotent. Existing `projects`, `runs` and
-- `intent_logs` rows are untouched; the new tables hang off them by id.
--
-- Design notes:
--   * `test_cases` is the structured, user-facing unit of a run. A run can have
--     many cases; a case carries its own status, category, and — when it fails —
--     a severity, impact, reproduction steps, code analysis, and the mocks or
--     stubs that were active. This replaces the previous "a run is a bag of
--     passed/failed journey names" shape.
--   * `findings` is the dismissible layer on top. A finding is fingerprinted so
--     the same issue is not re-reported on every later run once a human has
--     reviewed it.
--   * `project_context` holds per-repository variables, secrets, and seed data.
--     Secrets are encrypted at rest and never returned in plaintext.

create extension if not exists "pgcrypto";

-- 1. Pull requests -----------------------------------------------------------

create table if not exists pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  pr_number integer not null,
  title text,
  author_login text,
  -- "user" | "bot" — drives the "run on bot PRs" automation control.
  author_type text not null default 'user',
  -- "open" | "closed" | "merged"
  state text not null default 'open',
  is_draft boolean not null default false,
  head_branch text,
  base_branch text not null default 'main',
  head_sha text,
  html_url text,
  latest_run_id text references runs(id) on delete set null,
  -- Diff size, so a reviewer can see how much surface the run had to cover.
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

-- 2. Test cases --------------------------------------------------------------

create table if not exists test_cases (
  id uuid primary key default gen_random_uuid(),
  run_id text references runs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  pr_number integer,
  name text not null,
  route text,
  -- "passed" | "failed" | "skipped"
  status text not null default 'skipped',
  -- happy_path | edge | adversarial | logic | accessibility | mobile | visual | navigation
  category text not null default 'happy_path',
  -- critical | high | medium | low — null while the case passed or was skipped.
  severity text,
  impact text,
  failure_reason text,
  reproduction_steps jsonb not null default '[]'::jsonb,
  code_analysis jsonb not null default '[]'::jsonb,
  -- Mocks, stubs, seeded accounts and bypassed auth active during the case, so a
  -- failure can be judged against the environment it ran in.
  mock_context jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  -- new | regression | still_broken_verified | still_broken_inherited | carried_forward | fixed
  origin text not null default 'new',
  -- False for a case carried forward from the previous run because the diff did
  -- not touch it; those are reported separately and never inflate the signal.
  verified_this_commit boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_test_cases_run on test_cases(run_id);
create index if not exists idx_test_cases_project on test_cases(project_id);
create index if not exists idx_test_cases_severity on test_cases(severity);

-- 3. Dismissible findings ----------------------------------------------------

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  -- Stable hash of (route, category, normalized message) so the same issue keeps
  -- one identity across runs and commits.
  fingerprint text not null,
  severity text not null default 'medium',
  category text,
  title text not null,
  detail text,
  route text,
  first_seen_run_id text,
  last_seen_run_id text,
  -- open | dismissed | resolved
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

-- 4. Per-repository context (variables, secrets, seed data) ------------------

create table if not exists project_context (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  -- variable | secret | seed
  kind text not null,
  name text not null,
  -- Plaintext for variables and seed data. For secrets this holds ciphertext
  -- only and is never returned through the API.
  value text,
  encrypted boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind, name)
);

create index if not exists idx_project_context_project on project_context(project_id);

-- 5. Team members, roles and seats -------------------------------------------

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  -- GitHub organization login (or the account login for personal installs).
  org_login text not null,
  user_id uuid references auth.users(id) on delete cascade,
  github_login text,
  email text,
  -- admin | manager | member
  role text not null default 'member',
  seat_assigned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_login, user_id)
);

create index if not exists idx_team_members_org on team_members(org_login);

-- 6. Usage metering ----------------------------------------------------------
-- One row per billable or observable event. Kept deliberately simple: the
-- dashboard sums it; nothing here fabricates a number.

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  -- review | run | token | external_run
  event_type text not null,
  quantity integer not null default 1,
  unit_cost_usd numeric(10, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_created on usage_events(created_at desc);
create index if not exists idx_usage_events_project on usage_events(project_id);

-- 7. Row level security ------------------------------------------------------

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

-- 8. Saved tests (reusable regression suite) --------------------------------
-- A saved test is one flow the agent discovered (or a person described) that
-- should be exercised again on future runs. It is opt-in: generated test cases
-- are not saved automatically, because a suite that grows from every run
-- becomes noise. `fingerprint` keeps one identity per flow across runs.

create table if not exists saved_tests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  name text not null,
  route text,
  -- happy_path | logic | edge | adversarial | accessibility | mobile | visual | navigation | build
  category text not null default 'happy_path',
  -- Plain-language description of what to exercise, passed to the planner.
  intent text,
  -- Named setup this test depends on (seeded accounts, known records).
  preconditions jsonb not null default '[]'::jsonb,
  -- Where it came from, for traceability.
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
