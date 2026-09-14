"""Decoupled Job Queue & Worker Pool ported from langpeanut-cloud architecture.

Manages atomic job claims, push debounce and superseding (cancelling obsolete runs
on rapid commits), deduplication, and worker concurrency limits via Semaphore to
prevent Playwright/Docker container resource starvation.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from typing import Any, Callable, Coroutine
from uuid import uuid4

from pydantic import BaseModel, Field

from agent.bridge.models import IntentEvent
from agent.db.supabase import default_run_store

logger = logging.getLogger("agent.runner.queue")

# Caps for the in-memory dicts below. This is a long-lived worker process
# with no external supervisor evicting old entries; without a cap,
# _jobs/_successful_runs_cache/_branch_active_job grow forever (one entry per
# job/commit/branch ever seen for the lifetime of the process), which is an
# unbounded memory leak on a busy deployment. Oldest entries are dropped
# first once the cap is hit — a rare, brief cache miss (falling back to a
# fresh run) is an acceptable cost for bounded memory.
_MAX_TRACKED_JOBS = 500
_MAX_CACHED_RESULTS = 200


class QueuedJob(BaseModel):
    """Represents a job queued for verification."""

    id: str = Field(default_factory=lambda: f"job_{uuid4().hex[:12]}")
    repo: str
    branch: str
    sha: str
    scope: str = "changed"
    test_type: str = "functional"
    trigger_type: str = "webhook_pr"  # webhook_pr, webhook_push, on_demand, bot_command
    status: str = "pending"  # pending, running, succeeded, failed, superseded, cancelled
    created_at: float = Field(default_factory=time.time)
    error: str | None = None


class JobQueue:
    """Manages asynchronous test run jobs with concurrency throttling and push superseding."""

    def __init__(self, max_concurrent: int | None = None) -> None:
        if max_concurrent is None:
            try:
                max_concurrent = int(os.environ.get("MAX_CONCURRENT_JOBS", "2"))
            except ValueError:
                max_concurrent = 2
        self.max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._jobs: dict[str, QueuedJob] = {}
        self._running_tasks: dict[str, asyncio.Task[Any]] = {}
        self._branch_active_job: dict[str, str] = {}  # "owner/repo:branch" -> job_id
        self._successful_runs_cache: dict[str, dict[str, Any]] = {}  # sha_hash -> result
        self._job_containers: dict[str, str] = {}  # job_id -> docker container_name
        self._job_run_ids: dict[str, str] = {}  # run_id -> job_id (push runs differ)

    def register_container(self, job_id: str, container_name: str) -> None:
        """Associate a running Docker container name with a job for immediate termination on cancel."""
        self._job_containers[job_id] = container_name

    def unregister_container(self, job_id: str) -> None:
        """Disassociate a Docker container name when the container is shut down cleanly."""
        self._job_containers.pop(job_id, None)

    def _stop_job_container(self, job_id: str) -> None:
        """Stop the Docker container a job is using, if one is registered."""
        container = self._job_containers.pop(job_id, None)
        if not container:
            return
        import subprocess

        try:
            subprocess.run(["docker", "stop", container], capture_output=True, timeout=10)
            logger.info("Terminated Docker container %s for job %s", container, job_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to stop container %s for job %s: %s", container, job_id, exc)

    def is_job_cancelled(self, job_id: str) -> bool:
        """Check if a job has been superseded or cancelled."""
        job = self._jobs.get(job_id)
        return job is not None and job.status in ("superseded", "cancelled")

    def get_job(self, job_id: str) -> QueuedJob | None:
        """Lookup job state by ID."""
        return self._jobs.get(job_id)

    def find_job_for_run(self, run_id: str) -> QueuedJob | None:
        """Resolve the job that produced a run id.

        PR/bot jobs use ``job.id`` as the run id, but push-triggered jobs create a
        separate run record up front, so the id alone is not enough.
        """
        return self._jobs.get(run_id) or self._jobs.get(self._job_run_ids.get(run_id, ""))

    def list_jobs(self) -> list[QueuedJob]:
        """Snapshot of tracked jobs, newest first (bounded by ``_MAX_TRACKED_JOBS``)."""
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    def cancel_job(self, job_id: str, reason: str = "Cancelled by user") -> bool:
        """Cancel a pending or running job, stopping its container immediately.

        Returns True when a live job was cancelled; False for an unknown or
        already-settled job (so callers can report an honest 404/409).
        """
        job = self._jobs.get(job_id)
        if job is None or job.status not in ("pending", "running"):
            return False
        logger.info("Cancelling job %s: %s", job_id, reason)
        job.status = "cancelled"
        job.error = reason
        task = self._running_tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        self._stop_job_container(job_id)
        return True

    def cancel_job_by_run(self, run_id: str, reason: str = "Cancelled by user") -> bool:
        """Cancel the job associated with a run id (push runs included)."""
        job = self.find_job_for_run(run_id)
        return self.cancel_job(job.id, reason) if job is not None else False

    @staticmethod
    def _evict_oldest_if_over_cap(d: dict[Any, Any], cap: int) -> None:
        """Dicts preserve insertion order in Python; drop the oldest entries
        once over the cap rather than growing unbounded for process lifetime."""
        while len(d) > cap:
            oldest_key = next(iter(d))
            d.pop(oldest_key, None)

    def compute_job_hash(self, repo: str, sha: str, scope: str, test_type: str) -> str:
        """Compute deterministic hash to identify duplicate run requests."""
        raw = f"{repo}:{sha}:{scope}:{test_type}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def has_duplicate_successful_run(self, repo: str, sha: str, scope: str, test_type: str) -> dict[str, Any] | None:
        """Check if this exact commit and configuration was already tested clean."""
        key = self.compute_job_hash(repo, sha, scope, test_type)
        return self._successful_runs_cache.get(key)

    def cancel_branch_jobs(self, repo: str, branch: str, reason: str = "Superseded by newer commit") -> int:
        """Cancel and supersede older pending or running jobs on the same branch."""
        branch_key = f"{repo}:{branch}"
        cancelled_count = 0
        old_job_id = self._branch_active_job.get(branch_key)
        if old_job_id and old_job_id in self._jobs:
            job = self._jobs[old_job_id]
            if job.status in ("pending", "running"):
                logger.info("Superseding older job %s for branch '%s': %s", old_job_id, branch, reason)
                job.status = "superseded"
                job.error = reason
                task = self._running_tasks.get(old_job_id)
                if task and not task.done():
                    task.cancel()
                    cancelled_count += 1
                # Terminate any active Docker container running in a worker thread immediately
                self._stop_job_container(old_job_id)
        return cancelled_count

    async def submit_job(
        self,
        repo: str,
        branch: str,
        sha: str,
        pipeline_coro_fn: Callable[[QueuedJob], Coroutine[Any, Any, dict[str, Any]]],
        scope: str = "changed",
        test_type: str = "functional",
        trigger_type: str = "webhook_pr",
        run_id: str | None = None,
    ) -> QueuedJob:
        """Submit a job, superseding older runs on the same branch and throttling concurrency.

        ``run_id`` links the job to a run record whose id differs from ``job.id``
        (push-triggered runs create their record before the job), so a later
        cancel-by-run-id can find it.
        """
        # 1. Supersede any older in-flight runs on this branch (debounce rapid pushes)
        self.cancel_branch_jobs(repo, branch)

        # 2. Register new job
        job = QueuedJob(
            repo=repo,
            branch=branch,
            sha=sha,
            scope=scope,
            test_type=test_type,
            trigger_type=trigger_type,
            status="pending",
        )
        self._jobs[job.id] = job
        self._evict_oldest_if_over_cap(self._jobs, _MAX_TRACKED_JOBS)
        branch_key = f"{repo}:{branch}"
        self._branch_active_job[branch_key] = job.id
        self._evict_oldest_if_over_cap(self._branch_active_job, _MAX_TRACKED_JOBS)
        if run_id:
            self._job_run_ids[run_id] = job.id
            self._evict_oldest_if_over_cap(self._job_run_ids, _MAX_TRACKED_JOBS)

        # 3. Spawn background worker wrapper
        async def _worker() -> None:
            async with self._semaphore:
                if job.status in ("superseded", "cancelled"):
                    logger.info("Job %s was %s before worker acquisition; skipping.", job.id, job.status)
                    return

                job.status = "running"
                logger.info("Job %s acquired execution slot for %s on %s (SHA %s)", job.id, repo, branch, sha[:8])
                try:
                    res = await pipeline_coro_fn(job)
                    outcome = res.get("status")
                    if outcome == "success":
                        job.status = "succeeded"
                    elif outcome == "cancelled":
                        job.status = "cancelled"
                        job.error = job.error or res.get("error") or "Cancelled"
                    else:
                        job.status = "failed"
                    if job.status == "succeeded":
                        hash_key = self.compute_job_hash(repo, sha, scope, test_type)
                        self._successful_runs_cache[hash_key] = res
                        self._evict_oldest_if_over_cap(self._successful_runs_cache, _MAX_CACHED_RESULTS)
                except asyncio.CancelledError:
                    # cancel_job/cancel_branch_jobs set the precise status before
                    # cancelling the task; keep it, and only fall back when the
                    # cancellation came from somewhere else.
                    if job.status not in ("superseded", "cancelled"):
                        job.status = "cancelled"
                        job.error = job.error or "Cancelled during execution"
                    logger.info("Job %s was cancelled during execution (%s).", job.id, job.status)
                    raise
                except Exception as exc:
                    job.status = "failed"
                    job.error = str(exc)
                    logger.error("Job %s failed with error: %s", job.id, exc, exc_info=True)
                finally:
                    self._running_tasks.pop(job.id, None)
                    self._stop_job_container(job.id)

        task = asyncio.create_task(_worker())
        self._running_tasks[job.id] = task
        return job


# Default global queue instance
default_job_queue = JobQueue(max_concurrent=2)
