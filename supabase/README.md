# Supabase setup, migrations, and tenant scoping

## Applying the schema

1. Create a Supabase project.
2. Open **SQL Editor** and run `schema.sql` (idempotent).
3. Apply every file in `migrations/` in filename order (also idempotent).

The dashboard and engine tolerate the optional columns being absent, but some
features degrade silently until the migration is applied:

| Column | Needed by | Behaviour without it |
| :--- | :--- | :--- |
| `projects.default_branch` | project settings | branch selection is not persisted |
| `projects.imported_at` | `GET /api/github/repos` | "already imported" detection is imprecise |
| owner-scoped RLS policies | dashboard import | publishable-key writes fail with an RLS error |

### Verifying it is applied

```sql
select column_name
from information_schema.columns
where table_name = 'projects'
order by column_name;
```

You should see `default_branch` and `imported_at` alongside `id`, `user_id`,
`installation_id`, `repo_full_name`, `settings`, `encrypted_test_credentials`,
`created_at`, `updated_at`.

> The engine cannot apply DDL for you: it holds a PostgREST service key, not a
> database connection string. Apply migrations through the SQL Editor, the
> Supabase CLI, or `psql "$DATABASE_URL" -f migrations/<file>.sql`.

## Tenant scoping

`/api/runs` and `/api/projects` only return rows for repositories the signed-in
user has imported (`web/lib/tenant.ts`). Ownerless rows — created by webhooks or
older agent versions — are **hidden by default**.

Two ways to deal with legacy ownerless projects:

**1. Claim them for a user (recommended, one-off):**

```sql
-- Replace with the user's id from Authentication → Users.
update projects
set user_id = '<USER_UUID>'
where user_id is null;
```

**2. Restore the old permissive behaviour (single-tenant deployments only):**

```bash
SHOW_UNOWNED_PROJECTS=true
```

This makes every ownerless row visible to *every* signed-in user, which is the
cross-tenant exposure the strict default exists to prevent. Prefer option 1.

Once strict scoping hides rows, `GET /api/projects` still reports how many are
hidden in `hidden_unowned_projects`, so the empty state can be explained.
