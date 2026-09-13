#!/usr/bin/env python
"""Remove test-suite leftovers from the configured Supabase database.

Why this exists
---------------
The test suite used to share whatever ``SUPABASE_*`` credentials were in the
environment. Running pytest from a checkout whose ``agent/.env`` pointed at a
live project therefore inserted fixture runs (`acme-corp`, `acme-api-test`, …)
into the real ``runs`` table, where they appeared in the dashboard as genuine
verifications.

``agent/tests/conftest.py`` and ``agent.db.supabase.get_supabase_client`` now
make that impossible for new runs. This script cleans up rows written before
that guard existed.

Usage
-----
    uv --directory agent run python scripts/purge_fixture_runs.py           # preview
    uv --directory agent run python scripts/purge_fixture_runs.py --apply   # delete

It only ever touches rows that carry a fixture branch name or a loopback /
placeholder URL, and it prints each candidate before doing anything.
"""

from __future__ import annotations

import argparse
import json
import sys

from agent.config import load_env

load_env()

from agent.runner.retention import cleanup_fixture_runs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete the matched rows. Without this the script only previews.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the summary as JSON instead of human-readable text.",
    )
    args = parser.parse_args()

    summary = cleanup_fixture_runs(dry_run=not args.apply)

    if args.json:
        print(json.dumps(summary, indent=2))
        return 0

    count = summary["count"]
    if count == 0:
        print("No fixture runs found. Nothing to clean up.")
        return 0

    verb = "Deleted" if args.apply else "Would delete"
    print(f"{verb} {count} run row(s):\n")
    for row in summary["candidates"]:
        print(
            f"  {row['id']}  branch={row['branch']!r}  sha={row['sha']!r}  "
            f"scope={row['scope']!r}  status={row['status']!r}  created={row['created_at']}"
        )

    if args.apply:
        print(f"\nDeleted {summary['deleted']} row(s).")
    else:
        print("\nThis was a preview. Re-run with --apply to delete these rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
