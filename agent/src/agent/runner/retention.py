"""Artifact and workspace retention policy manager.

Ensures source code and forensic test artifacts are not stored indefinitely
after runs complete, fulfilling the "source code never stored" guarantee.
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

logger = logging.getLogger("agent.runner.retention")

DEFAULT_ARTIFACT_RETENTION_SECONDS = 7 * 86400.0  # 7 days


def cleanup_local_artifacts(
    max_age_seconds: float = DEFAULT_ARTIFACT_RETENTION_SECONDS,
    base_dirs: list[Path] | None = None,
    active_run_ids: set[str] | list[str] | None = None,
) -> int:
    """Purges run artifact and workspace directories older than `max_age_seconds`.

    Explicitly protects in-progress runs from premature deletion.
    Returns the count of purged directories.
    """
    if base_dirs is None:
        from agent.runner.pipeline import ARTIFACTS_BASE, WORKSPACES_BASE
        base_dirs = [ARTIFACTS_BASE, WORKSPACES_BASE]

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
        from agent.runner.pipeline import ARTIFACTS_BASE, WORKSPACES_BASE
        base_dirs = [ARTIFACTS_BASE, WORKSPACES_BASE]

    purged = False
    for b_dir in base_dirs:
        target = b_dir / run_dir_name
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
            purged = True
            logger.info("Purged run directory: %s", target)
    return purged
