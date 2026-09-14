import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Resolve whether a signed-in user actually has the GitHub App connected, and
 * gate repository import on it.
 *
 * Background
 * ----------
 * A GitHub App installation belongs to an *account* (a user or an organization),
 * never to an application user. The `installations` table used to be a global
 * catalogue with nothing tying a row back to a person, which meant:
 *
 *   * discovery returned every tenant's repositories to every signed-in user,
 *     and
 *   * the import gate had to fail open whenever the table was unreadable.
 *
 * Both are closed here. Ownership is taken from `installed_by_github_user_id`,
 * captured from the signature-verified `installation` webhook `sender` (see
 * agent/src/agent/api/webhooks.py). Rows that predate that column — or that
 * were catalogued by `GET /app/installations`, which does not expose the
 * installer — fall back to matching `account_login` against the user's GitHub
 * login. That fallback is sound: GitHub reserves organization names from being
 * user logins, so an exact login match identifies the account holder.
 *
 * This module reads `installations`, which is service-role-only under RLS, so
 * callers must pass the admin client.
 */

export interface GitHubIdentity {
  /** GitHub numeric user id as a string (Supabase stores identity `sub` as text). */
  id: string | null;
  /** GitHub login (username), as of the user's last sign-in. */
  login: string | null;
}

export interface ConnectionInstallation {
  installation_id: number;
  account_login: string | null;
  account_id: number | null;
  /** True when the row explicitly names this user as the installer. */
  installed_by_user: boolean;
}

export type ConnectionReason = "connected" | "not_installed" | "app_not_configured";

export interface GitHubConnection {
  /** Whether this deployment has a GitHub App configured at all. */
  appConfigured: boolean;
  /** Whether the signed-in user may use at least one installation. */
  connected: boolean;
  reason: ConnectionReason;
  /** The installations this user may import through. */
  installations: ConnectionInstallation[];
  installationIds: number[];
  /** Where to send the user to install / authorize the App. */
  connectUrl: string;
  /**
   * Whether the signed-in account has a linked GitHub identity.
   *
   * Ownership is proved with the GitHub user id, so an account that signed up
   * with email/password and never linked GitHub can install the App and still
   * never match an installation. The UI uses this to explain that instead of
   * leaving the user on a connect screen that cannot succeed.
   */
  githubIdentityLinked: boolean;
  /** The linked GitHub login, when there is one. */
  githubLogin: string | null;
}

export interface RepoImportAuthorization {
  allowed: boolean;
  /** Installation the repository was found in, when one matched. */
  installationId: number | null;
  connection: GitHubConnection;
  /** Caller-facing reason when `allowed` is false. */
  error?: string;
}

const DEFAULT_RETURN_PATH = "/dashboard/new";

const INSTALLATION_COLUMNS =
  "installation_id, account_login, account_id, installed_by_github_user_id, installed_by_login";

/** Columns that exist on every deployment, including pre-ownership databases. */
const LEGACY_INSTALLATION_COLUMNS = "installation_id, account_login, account_id";

interface InstallationRow {
  installation_id: number;
  account_login: string | null;
  account_id: number | null;
  installed_by_github_user_id: number | string | null;
  installed_by_login: string | null;
}

/**
 * Whether a GitHub App is configured for this deployment. The slug is what the
 * install redirect needs; the App id is accepted as a hint because deployments
 * that install the App from the landing page may only set that.
 */
export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_SLUG ||
      process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ||
      process.env.GITHUB_APP_ID
  );
}

/**
 * Whether import must be gated on a GitHub App installation.
 *
 * Defaults to "yes whenever an App is configured". A single-tenant / self-hosted
 * deployment that shares one installation across every user can set
 * `GITHUB_APP_REQUIRE_INSTALLATION=false` to restore the previous behaviour —
 * the same escape hatch spirit as SHOW_UNOWNED_PROJECTS in lib/tenant.ts.
 */
export function isInstallationRequired(): boolean {
  if (process.env.GITHUB_APP_REQUIRE_INSTALLATION === "false") return false;
  return isGitHubAppConfigured();
}

/**
 * Build the link that starts the install flow and returns the user to
 * `returnTo` (with a marker the UI uses to re-check once the webhook lands).
 */
export function gitHubAppConnectUrl(returnTo: string = DEFAULT_RETURN_PATH): string {
  const withMarker = returnTo.includes("?")
    ? `${returnTo}&github_app=connected`
    : `${returnTo}?github_app=connected`;
  return `/api/github/install?state=${encodeURIComponent(withMarker)}`;
}

/**
 * Validate a post-install return target.
 *
 * GitHub reflects `state` back to the App's Setup URL, and both `/api/github/install`
 * and the setup callback redirect to it. Without this check an attacker could
 * send a victim through our own install route with
 * `state=https://evil.example`, and GitHub would return them there — an open
 * redirect. Only same-origin paths are allowed.
 */
export function sanitizeReturnPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_RETURN_PATH
): string {
  if (!raw) return fallback;
  const value = raw.trim();

  // Must be an absolute *path*: reject absolute URLs, protocol-relative
  // (`//evil.example`), backslash tricks, and control characters.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  return value;
}

/** Extract the GitHub identity from a Supabase user's linked providers. */
export function resolveGitHubIdentity(
  user: Pick<User, "identities"> | null | undefined
): GitHubIdentity {
  const identity = user?.identities?.find((candidate) => candidate.provider === "github");
  if (!identity) {
    return { id: null, login: null };
  }

  const data = (identity.identity_data || {}) as Record<string, unknown>;
  const rawId = data.sub ?? data.id ?? null;
  const rawLogin = data.user_name ?? data.preferred_username ?? data.login ?? null;

  return {
    id: rawId != null && String(rawId).trim() ? String(rawId).trim() : null,
    login: typeof rawLogin === "string" && rawLogin.trim() ? rawLogin.trim() : null,
  };
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message || "");
}

/**
 * Read the installation catalogue, tolerating a database where the ownership
 * migration has not been applied yet. Missing columns degrade to `null`, which
 * routes those rows through the account-login fallback rather than failing the
 * request — a hard failure here would lock every user out of import.
 */
async function loadInstallationRows(admin: SupabaseClient): Promise<InstallationRow[]> {
  const select = (columns: string) =>
    admin.from("installations").select(columns).order("created_at", { ascending: false });

  let { data, error } = await select(INSTALLATION_COLUMNS);

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await select(LEGACY_INSTALLATION_COLUMNS));
  }

  if (error || !data) {
    if (error) {
      console.error("Failed to read GitHub App installations:", error.message);
    }
    return [];
  }

  // The select string is built at runtime so PostgREST cannot infer a row type;
  // the two branches return the same shape modulo the optional ownership columns.
  const rows = data as unknown as Record<string, unknown>[];

  return rows.map((row) => ({
    installation_id: Number(row.installation_id),
    account_login: (row.account_login as string | null) ?? null,
    account_id: row.account_id != null ? Number(row.account_id) : null,
    installed_by_github_user_id:
      (row.installed_by_github_user_id as number | string | null) ?? null,
    installed_by_login: (row.installed_by_login as string | null) ?? null,
  }));
}

/**
 * Resolve which installations the signed-in user may use.
 *
 * Fail-closed: with an App configured, an unreadable catalogue or a user with
 * no provable installation yields `connected: false`. The single-tenant escape
 * hatch is `GITHUB_APP_REQUIRE_INSTALLATION=false`, not an empty table.
 */
export async function resolveGitHubConnection(
  admin: SupabaseClient,
  user: Pick<User, "identities">
): Promise<GitHubConnection> {
  const appConfigured = isGitHubAppConfigured();
  const connectUrl = gitHubAppConnectUrl();
  const identity = resolveGitHubIdentity(user);
  const identityFields = {
    githubIdentityLinked: Boolean(identity.id || identity.login),
    githubLogin: identity.login,
  };

  if (!isInstallationRequired()) {
    return {
      appConfigured,
      connected: true,
      reason: appConfigured ? "connected" : "app_not_configured",
      installations: [],
      installationIds: [],
      connectUrl,
      ...identityFields,
    };
  }

  const rows = await loadInstallationRows(admin);

  const installations: ConnectionInstallation[] = [];
  for (const row of rows) {
    const recorded =
      row.installed_by_github_user_id != null
        ? String(row.installed_by_github_user_id).trim()
        : null;

    // 1. Explicit, signature-verified installer match. This is the only path
    //    that counts for organization installations.
    if (recorded && identity.id && recorded === identity.id) {
      installations.push({ ...toConnectionInstallation(row), installed_by_user: true });
      continue;
    }

    // 2. Unknown installer: fall back to an exact account-login match, which
    //    only succeeds for the personal account that owns the login.
    if (
      !recorded &&
      identity.login &&
      (row.account_login || "").trim().toLowerCase() === identity.login.toLowerCase()
    ) {
      installations.push({ ...toConnectionInstallation(row), installed_by_user: false });
    }
  }

  return {
    appConfigured,
    connected: installations.length > 0,
    reason: installations.length > 0 ? "connected" : "not_installed",
    installations,
    installationIds: installations.map((installation) => installation.installation_id),
    connectUrl,
    ...identityFields,
  };
}

function toConnectionInstallation(row: InstallationRow): ConnectionInstallation {
  return {
    installation_id: row.installation_id,
    account_login: row.account_login,
    account_id: row.account_id,
    installed_by_user: false,
  };
}

/**
 * Decide whether `repoFullName` may be imported by this user.
 *
 * Two independent conditions must hold when the App is required:
 *   1. the user has at least one installation (the "connect first" gate), and
 *   2. the repository is granted to one of *their* installations.
 *
 * Condition 2 is what stops a connected user from importing a repository that
 * belongs to somebody else's installation by typing it into the manual field.
 */
export async function authorizeRepoImport(
  admin: SupabaseClient,
  user: Pick<User, "identities">,
  repoFullName: string
): Promise<RepoImportAuthorization> {
  const connection = await resolveGitHubConnection(admin, user);

  if (!isInstallationRequired()) {
    return { allowed: true, installationId: null, connection };
  }

  if (!connection.connected) {
    return {
      allowed: false,
      installationId: null,
      connection,
      error:
        "Connect the RazeQA GitHub App to this account before importing a repository. " +
        "Install it on the repositories you want RazeQA to test, then return here.",
    };
  }

  const installationId = await findInstallationForRepo(
    admin,
    connection.installationIds,
    repoFullName
  );

  if (installationId === null) {
    return {
      allowed: false,
      installationId: null,
      connection,
      error:
        `Repository '${repoFullName}' is not granted to any GitHub App installation on ` +
        "this account. Grant the App access to it in GitHub, then retry.",
    };
  }

  return { allowed: true, installationId, connection };
}

/**
 * Find which of `installationIds` grants `repoFullName`, or null. Reads the
 * per-installation repository catalogue populated by the webhook and
 * `POST /api/github/sync`.
 */
async function findInstallationForRepo(
  admin: SupabaseClient,
  installationIds: number[],
  repoFullName: string
): Promise<number | null> {
  if (installationIds.length === 0) return null;

  const { data, error } = await admin
    .from("installations")
    .select("installation_id, repositories")
    .in("installation_id", installationIds);

  if (error || !data) {
    if (error) {
      console.error("Failed to resolve installation for repository:", error.message);
    }
    return null;
  }

  const needle = repoFullName.toLowerCase();
  for (const row of data as { installation_id: number; repositories: unknown }[]) {
    const repos = Array.isArray(row.repositories) ? row.repositories : [];
    for (const repo of repos) {
      const entry = repo as { full_name?: string; name?: string } | null;
      const full = String(entry?.full_name || entry?.name || "").toLowerCase();
      if (full && full === needle) {
        return Number(row.installation_id);
      }
    }
  }

  return null;
}

/**
 * Restrict a discovered repository list to the installations the caller owns.
 *
 * Discovery in the web layer is a union across every installation the App
 * knows about, so this filter — not the UI — is what keeps tenants apart.
 */
export function filterReposByInstallations<T extends { installation_id: number | null }>(
  repos: T[],
  installationIds: number[]
): T[] {
  const allowed = new Set(installationIds);
  return repos.filter(
    (repo) => repo.installation_id !== null && allowed.has(repo.installation_id)
  );
}
