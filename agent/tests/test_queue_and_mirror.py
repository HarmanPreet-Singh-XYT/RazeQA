"""Tests for decoupled JobQueue and MirrorManager."""

import asyncio
from pathlib import Path
import pytest

from agent.runner.queue import JobQueue, QueuedJob
from agent.runner.mirror import MirrorManager


@pytest.mark.asyncio
async def test_job_queue_push_superseding():
    queue = JobQueue(max_concurrent=2)
    repo = "owner/repo"
    branch = "feature/payments"

    started_events = []
    finish_events = []

    async def mock_long_pipeline(job: QueuedJob):
        started_events.append(job.id)
        await asyncio.sleep(0.5)
        finish_events.append(job.id)
        return {"status": "success"}

    # Submit first job
    job1 = await queue.submit_job(
        repo=repo,
        branch=branch,
        sha="commit_111111",
        pipeline_coro_fn=mock_long_pipeline,
    )

    # Let job1 start running
    await asyncio.sleep(0.05)

    # Rapid push occurs: submit job2 on the exact same branch
    job2 = await queue.submit_job(
        repo=repo,
        branch=branch,
        sha="commit_222222",
        pipeline_coro_fn=mock_long_pipeline,
    )

    # Allow processing to settle
    await asyncio.sleep(0.6)

    # Job 1 must have been superseded
    assert job1.status == "superseded"
    # Job 2 should have completed
    assert job2.status == "succeeded"
    assert job2.id in finish_events


@pytest.mark.asyncio
async def test_job_queue_concurrency_semaphore():
    # Allow at most 1 concurrent run
    queue = JobQueue(max_concurrent=1)
    concurrent_active = 0
    max_observed_concurrent = 0

    async def mock_worker(job: QueuedJob):
        nonlocal concurrent_active, max_observed_concurrent
        concurrent_active += 1
        max_observed_concurrent = max(max_observed_concurrent, concurrent_active)
        await asyncio.sleep(0.1)
        concurrent_active -= 1
        return {"status": "success"}

    # Submit jobs for two DIFFERENT branches (so neither is superseded)
    j1 = await queue.submit_job("owner/repo", "branch-a", "sha1", mock_worker)
    j2 = await queue.submit_job("owner/repo", "branch-b", "sha2", mock_worker)

    await asyncio.sleep(0.3)

    assert j1.status == "succeeded"
    assert j2.status == "succeeded"
    # Never ran more than 1 in parallel
    assert max_observed_concurrent == 1


def test_job_queue_deduplication():
    queue = JobQueue()
    repo = "owner/repo"
    sha = "aabbcc123"
    scope = "changed"
    test_type = "functional"

    assert queue.has_duplicate_successful_run(repo, sha, scope, test_type) is None

    # Record fake successful run
    key = queue.compute_job_hash(repo, sha, scope, test_type)
    queue._successful_runs_cache[key] = {"status": "success", "cached": True}

    cached = queue.has_duplicate_successful_run(repo, sha, scope, test_type)
    assert cached is not None
    assert cached["cached"] is True


def test_mirror_manager_initialization(tmp_path: Path):
    mirror_dir = tmp_path / "mirrors"
    manager = MirrorManager(base_dir=mirror_dir)

    assert mirror_dir.exists()

    # Simulate stale lock file
    fake_mirror = mirror_dir / "owner_repo.git"
    fake_mirror.mkdir(parents=True)
    stale_lock = fake_mirror / "index.lock"
    stale_lock.write_text("locked")

    assert stale_lock.exists()
    manager._clean_stale_locks(fake_mirror)
    assert not stale_lock.exists()
