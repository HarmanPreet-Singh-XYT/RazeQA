-- Migration: outbound email notifications
--
-- Why this exists
-- ---------------
-- RazeQA had no way to tell a human that something happened. A failed
-- verification, a new critical finding, a finished review or a published fix
-- was visible only to whoever happened to open the dashboard. This adds the
-- persistence layer for outbound email: one durable row per message, so a
-- send can be retried, deduplicated and audited instead of fired blind from
-- inside a request.
--
-- The row is the unit of truth. A message is enqueued first and delivered by a
-- background drain, which is what makes the pipeline's notification call safe
-- to place on the critical path — it can never block a run on an SMTP handshake.
--
-- Recipient preferences deliberately do NOT get a table: they live in the
-- existing `projects.settings.notifications` JSONB blob, exactly like
-- `settings.automation`, so they travel with the project and need no schema
-- change to evolve.
--
-- Applying this file is idempotent; it is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Outbound email outbox
-- ---------------------------------------------------------------------------

create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  repo_full_name text,
  run_id text,
  pr_number integer,
  -- run_completed | findings_alert | review_completed | fix_published | test
  kind text not null,
  recipients jsonb not null default '[]'::jsonb,
  cc jsonb not null default '[]'::jsonb,
  subject text not null,
  body_text text not null,
  body_html text,
  -- queued | sending | sent | failed | skipped
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  -- Deterministic identity for a logical event, so a retried pipeline cannot
  -- send the same run-completed mail twice. Null means "never deduplicated".
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

-- A partial unique index is what makes at-least-once delivery safe: the second
-- insert of the same event loses the race and is discarded by the enqueue
-- helper instead of mailing the recipients again.
create unique index if not exists idx_email_messages_dedupe
  on email_messages (dedupe_key)
  where dedupe_key is not null;

create index if not exists idx_email_messages_status
  on email_messages (status, created_at desc);
create index if not exists idx_email_messages_repo
  on email_messages (repo_full_name, created_at desc);
create index if not exists idx_email_messages_project
  on email_messages (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Row level security
-- ---------------------------------------------------------------------------

alter table email_messages enable row level security;

drop policy if exists "Service role full access on email_messages" on email_messages;
create policy "Service role full access on email_messages" on email_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Owners can read the delivery log for their own projects (the dashboard's
-- notification settings page shows recent delivery attempts).
drop policy if exists "Users can view own email messages" on email_messages;
create policy "Users can view own email messages" on email_messages
  for select
  using (
    exists (
      select 1 from projects
      where projects.id = email_messages.project_id
        and projects.user_id = auth.uid()
    )
  );
