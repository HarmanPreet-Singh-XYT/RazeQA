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

    def register_container(self, job_id: str, container_name: str) -> None:
        """Associate a running Docker container name with a job for immediate termination on cancel."""
        self._job_containers[job_id] = container_name

    def unregister_container(self, job_id: str) -> None:
        """Disassociate a Docker container name when the container is shut down cleanly."""
        self._job_containers.pop(job_id, None)

    def is_job_cancelled(self, job_id: str) -> bool:
        """Check if a job has been superseded or cancelled."""
        job = self._jobs.get(job_id)
        return job is not None and job.status in ("superseded", "cancelled")

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
                container = self._job_containers.pop(old_job_id, None)
                if container:
                    import subprocess
                    try:
                        subprocess.run(["docker", "stop", container], capture_output=True, timeout=10)
                        logger.info("Terminated Docker container %s for superseded job %s", container, old_job_id)
                    except Exception as e:
                        logger.warning("Failed to stop container %s for superseded job %s: %s", container, old_job_id, e)
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
    ) -> QueuedJob:
        """Submit a job, superseding older runs on the same branch and throttling concurrency."""
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

        # 3. Spawn background worker wrapper
        async def _worker() -> None:
            async with self._semaphore:
                if job.status == "superseded":
                    logger.info("Job %s was superseded before worker acquisition; skipping.", job.id)
                    return

                job.status = "running"
                logger.info("Job %s acquired execution slot for %s on %s (SHA %s)", job.id, repo, branch, sha[:8])
                try:
                    res = await pipeline_coro_fn(job)
                    job.status = "succeeded" if res.get("status") == "success" else "failed"
                    if job.status == "succeeded":
                        hash_key = self.compute_job_hash(repo, sha, scope, test_type)
                        self._successful_runs_cache[hash_key] = res
                        self._evict_oldest_if_over_cap(self._successful_runs_cache, _MAX_CACHED_RESULTS)
                except asyncio.CancelledError:
                    job.status = "superseded"
                    job.error = "Cancelled due to branch update"
                    logger.info("Job %s was cancelled during execution.", job.id)
                    raise
                except Exception as exc:
                    job.status = "failed"
                    job.error = str(exc)
                    logger.error("Job %s failed with error: %s", job.id, exc, exc_info=True)
                finally:
                    self._running_tasks.pop(job.id, None)

        task = asyncio.create_task(_worker())
        self._running_tasks[job.id] = task
        return job

    def get_job(self, job_id: str) -> QueuedJob | None:
        """Lookup job state by ID."""
        return self._jobs.get(job_id)


# Default global queue instance
default_job_queue = JobQueue(max_concurrent=2)
