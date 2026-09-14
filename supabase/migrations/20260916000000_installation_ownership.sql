-- Migration: record who installed a GitHub App installation
--
-- Why this exists
-- ---------------
-- `installations` was a global catalogue: `installation_id`, `account_login`,
-- `account_id`, `repositories`. Nothing linked a row to the person who
-- installed it, which produced two problems:
--
--   1. repository discovery returned every tenant's repositories to every
--      signed-in user (web/lib/github/discovery.ts read the whole table), and
--   2. import could not be gated on "do *you* have the App installed", so the
--      gate had to fail open (see the old isRepoReachableByInstallations).
--
-- A GitHub App installation belongs to an account (a user or an organization),
-- not to an application user. The `installation` webhook payload carries the
-- acting user in `sender` — the person who clicked Install — which is the
-- strongest, signature-verified link GitHub gives us. This migration stores it.
--
-- `installed_by_*` is deliberately nullable:
--   * rows created before this migration have no recorded installer, and
--   * neither the setup callback nor `POST /api/github/sync` can populate it,
--     because `GET /app/installations` does not expose the installer.
-- Readers treat NULL as "unknown" and fall back to matching `account_login`
-- against the signed-in user's GitHub login, which is sound for personal
-- accounts (GitHub reserves organization names from user logins). See
-- web/lib/github/connection.ts.
--
-- Applying this file is idempotent; it is safe to re-run.

alter table installations
  add column if not exists installed_by_github_user_id bigint;

alter table installations
  add column if not exists installed_by_login text;

-- Ownership lookups are of the form "find the installations this GitHub user
-- installed", so index the recorded installer rather than the account.
create index if not exists idx_installations_installed_by
  on installations (installed_by_github_user_id)
  where installed_by_github_user_id is not null;

comment on column installations.installed_by_github_user_id is
  'GitHub user id of the installer, from the signature-verified installation webhook sender. NULL = unknown (pre-existing row, or created without a webhook).';

comment on column installations.installed_by_login is
  'GitHub login of the installer at install time. Display/fallback only; may drift if the account is renamed.';
