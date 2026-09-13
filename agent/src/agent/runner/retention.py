"""Artifact and workspace retention policy manager.

Ensures source code and forensic test artifacts are not stored indefinitely
after runs complete, fulfilling the "source code never stored" guarantee.
"""

from __future__ import annotations

import logging
import shutil
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger("agent.runner.retention")

DEFAULT_ARTIFACT_RETENTION_SECONDS = 7 * 86400.0  # 7 days

#: 0 disables run-history purging: run rows are the dashboard's history and are
#: kept by default. Set RUN_HISTORY_RETENTION_SECONDS > 0 to expire the payloads
#: stored inside `runs.result` on the same schedule as the artifacts.
DEFAULT_RUN_HISTORY_RETENTION_SECONDS = 0.0


def cleanup_local_artifacts(
    max_age_seconds: float = DEFAULT_ARTIFACT_RETENTION_SECONDS,
    base_dirs: list[Path] | None = None,
    active_run_ids: set[str] | list[str] | None = None,
) -> int:
    """Purges run artifact directories older than `max_age_seconds`.

    Explicitly protects in-progress runs from premature deletion.
    Returns the count of purged directories.

    There is no longer any workspace directory to purge: per-run checkouts live
    only inside the sandbox container, which is destroyed when the run ends. Only
    ARTIFACTS_BASE (forensic output) persists on disk.
    """
    if base_dirs is None:
        from agent.runner.pipeline import ARTIFACTS_BASE
        base_dirs = [ARTIFACTS_BASE]

    # Resolve active runs if not explicitly provided
    active_ids: set[str] = set(active_run_ids or [])
    if not active_ids:
        try:
            from agent.runner.queue import default_job_queue
            for j in default_job_queue._jobs.values():
                if j.status in ("pending", "running"):
                    active_ids.add(j.id)
        except Exception:
            pass

    cutoff = time.time() - max_age_seconds
    purged_count = 0

    for b_dir in base_dirs:
        if not b_dir.exists():
            continue

        for child in b_dir.iterdir():
            if not child.is_dir():
                continue

            # Exclude active runs from being purged mid-flight
            if any(active_id in child.name for active_id in active_ids if active_id):
                logger.debug("Skipping in-progress run directory during retention cleanup: %s", child.name)
                continue

            try:
                mtime = child.stat().st_mtime
                if mtime < cutoff:
                    shutil.rmtree(child)
                    purged_count += 1
                    logger.info("Purged expired run artifact directory: %s", child.name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to clean up artifact directory %s: %s", child, exc)

    return purged_count


def purge_run_directory(run_dir_name: str, base_dirs: list[Path] | None = None) -> bool:
    """Immediately purges a specific run's forensic artifacts from disk."""
    if base_dirs is None:
        from agent.runner.pipeline import ARTIFACTS_BASE
        base_dirs = [ARTIFACTS_BASE]

    purged = False
    for b_dir in base_dirs:
        target = b_dir / run_dir_name
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
            purged = True
            logger.info("Purged run directory: %s", target)
    return purged


def cleanup_supabase_artifacts(
    max_age_seconds: float = DEFAULT_ARTIFACT_RETENTION_SECONDS,
) -> int:
    """Delete uploaded forensic artifacts older than the retention window.

    Local disk was swept but the private ``run-artifacts`` bucket never was, so
    videos/traces/screenshots accumulated in object storage forever — even after
    their local copies were purged — which contradicted the documented retention
    window. Returns the number of objects removed.
    """
    try:
        from agent.db.storage import default_artifact_storage

        if not default_artifact_storage.is_available():
            return 0

        stale = default_artifact_storage.collect_objects_older_than(max_age_seconds)
        if not stale:
            return 0

        deleted = default_artifact_storage.delete_objects(stale)
        logger.info("Purged %d expired artifact object(s) from Supabase storage", deleted)
        return deleted
    except Exception as exc:  # noqa: BLE001
        logger.warning("Supabase artifact retention pass failed: %s", exc)
        return 0


def cleanup_run_history(
    max_age_seconds: float = DEFAULT_RUN_HISTORY_RETENTION_SECONDS,
) -> int:
    """Delete DB run rows older than the cutoff; returns rows removed.

    Opt-in: a value <= 0 disables this entirely, because run rows are the
    dashboard's history. When enabled, it expires `runs.result` payloads (DOM
    snapshots, remediation text, per-path analytics) that object-storage and
    disk retention do not cover.
    """
    if max_age_seconds <= 0:
        return 0

    cutoff_iso = (datetime.now(UTC) - timedelta(seconds=max_age_seconds)).isoformat()
    try:
        from agent.db.supabase import default_run_store
    except Exception as exc:  # noqa: BLE001
        logger.warning("Run-history retention unavailable: %s", exc)
        return 0

    deleter = getattr(default_run_store, "delete_older_than", None)
    if not callable(deleter):
        return 0

    try:
        removed = int(deleter(cutoff_iso) or 0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Run-history retention pass failed: %s", exc)
        return 0

    if removed:
        logger.info("Purged %d run row(s) older than %s", removed, cutoff_iso)
    return removed


# ---------------------------------------------------------------------------
# Fixture-run cleanup
# ---------------------------------------------------------------------------

#: Branch names used by the test suite. A row carrying one of these was created
#: by pytest, not by a user.
FIXTURE_BRANCH_NAMES: tuple[str, ...] = (
    "acme-corp",
    "acme-api-test",
    "acme-storefront",
    "test-branch",
    "feat/test",
)

#: Hosts that only ever appear when tests run against their own loopback server.
FIXTURE_HOST_MARKERS: tuple[str, ...] = (
    "127.0.0.1",
    "localhost",
    "0.0.0.0",
    "example.com",
    "example.invalid",
)


def _is_fixture_run(row: dict) -> bool:
    """Whether a `runs` row looks like test output rather than a real run.

    Two independent fingerprints, because either alone has false positives:

    * a branch name from the fixture list, and
    * a branch/sha that is a loopback or placeholder URL (external verification
      runs store the target URL in `sha`, so a pytest-owned ephemeral port like
      ``http://127.0.0.1:55315`` is a definitive marker).

    A row must match at least one to be considered junk. Real user runs point at
    real hosts and carry real branch names.
    """
    branch = str(row.get("branch") or "").strip().lower()
    sha = str(row.get("sha") or "").strip().lower()

    if branch in FIXTURE_BRANCH_NAMES:
        return True

    for value in (branch, sha):
        if not value:
            continue
        if any(marker in value for marker in FIXTURE_HOST_MARKERS):
            return True
    return False


def find_fixture_runs() -> list[dict]:
    """Return `runs` rows that look like leftovers from the test suite."""
    from agent.db.supabase import get_supabase_client

    client = get_supabase_client()
    if client is None:
        return []

    try:
        res = (
            client.table("runs")
            .select("id, project_id, branch, sha, scope, status, created_at")
            .execute()
        )
        rows = res.data or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not list runs for fixture cleanup: %s", exc)
        return []

    return [row for row in rows if _is_fixture_run(row)]


def cleanup_fixture_runs(dry_run: bool = True) -> dict[str, Any]:
    """Delete run rows created by the test suite.

    Returns a summary rather than a bare count so callers can show the user
    exactly what would be (or was) removed. `dry_run` defaults to True: this
    deletes rows, and an accidental call should not be able to do so silently.
    """
    candidates = find_fixture_runs()
    summary: dict[str, Any] = {
        "candidates": [
            {
                "id": row.get("id"),
                "branch": row.get("branch"),
                "sha": row.get("sha"),
                "scope": row.get("scope"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "project_id": row.get("project_id"),
            }
            for row in candidates
        ],
        "count": len(candidates),
        "deleted": 0,
        "dry_run": dry_run,
    }

    if dry_run or not candidates:
        return summary

    from agent.db.supabase import get_supabase_client

    client = get_supabase_client()
    if client is None:
        return summary

    deleted = 0
    for row in candidates:
        try:
            client.table("runs").delete().eq("id", row["id"]).execute()
            deleted += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not delete fixture run %s: %s", row.get("id"), exc)

    summary["deleted"] = deleted
    if deleted:
        logger.info("Deleted %d fixture run row(s) from Supabase", deleted)
    return summary
