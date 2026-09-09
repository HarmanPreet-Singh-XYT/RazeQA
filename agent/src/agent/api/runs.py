"""On-demand and PR-triggered test run endpoints with SHA-based freshness checking."""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/runs", tags=["runs"])


class RunRequest(BaseModel):
    branch: str
    sha: str
    scope: str = "changed"
    test_type: str = "functional"


class RunRecord(BaseModel):
    run_id: str
    branch: str
    sha: str
    scope: str = "changed"
    test_type: str = "functional"
    status: str = "queued"  # queued, running, completed, failed, cached
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    completed_at: str | None = None
    result: dict[str, Any] | None = None


class RunStore:
    """In-memory run history store for freshness checking and deduplication."""

    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}
        self._lock = threading.Lock()

    def find_latest_by_sha(
        self, branch: str, sha: str, scope: str | None = None, test_type: str | None = None
    ) -> RunRecord | None:
        with self._lock:
            matches = [
                r
                for r in self._runs.values()
                if r.branch == branch
                and r.sha == sha
                and (scope is None or r.scope == scope)
                and (test_type is None or r.test_type == test_type)
            ]
            if not matches:
                return None
            return max(matches, key=lambda x: x.created_at)


    def create(self, branch: str, sha: str, scope: str = "changed", test_type: str = "functional") -> RunRecord:
        record = RunRecord(
            run_id=f"run_{uuid.uuid4().hex[:12]}",
            branch=branch,
            sha=sha,
            scope=scope,
            test_type=test_type,
            status="queued",
        )
        with self._lock:
            self._runs[record.run_id] = record
        return record

    def get(self, run_id: str) -> RunRecord | None:
        with self._lock:
            return self._runs.get(run_id)

    def update(
        self,
        run_id: str,
        status: str,
        result: dict[str, Any] | None = None,
        completed: bool = False,
    ) -> RunRecord | None:
        with self._lock:
            record = self._runs.get(run_id)
            if not record:
                return None
            record.status = status
            if result is not None:
                record.result = result
            if completed:
                record.completed_at = datetime.now(UTC).isoformat()
            return record

    def list_all(self, branch: str | None = None, sha: str | None = None) -> list[RunRecord]:
        with self._lock:
            items = list(self._runs.values())
            if branch:
                items = [r for r in items if r.branch == branch]
            if sha:
                items = [r for r in items if r.sha == sha]
            return sorted(items, key=lambda x: x.created_at, reverse=True)

    def clear(self) -> None:
        with self._lock:
            self._runs.clear()


run_store = RunStore()


def get_run_store() -> RunStore:
    return run_store


@router.post("")
async def trigger_run(payload: RunRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Trigger an on-demand test run with SHA-based freshness checking.

    If this exact commit SHA was already tested for this branch/scope,
    returns the cached run result without spinning up a redundant sandbox.
    """
    existing = run_store.find_latest_by_sha(
        branch=payload.branch,
        sha=payload.sha,
        scope=payload.scope,
        test_type=payload.test_type,
    )

    if existing is not None:
        if existing.status in ("completed", "cached"):
            return {
                "status": "cached",
                "fresh": False,
                "run_id": existing.run_id,
                "branch": existing.branch,
                "sha": existing.sha,
                "scope": existing.scope,
                "test_type": existing.test_type,
                "message": "Result returned from cache for this exact commit SHA.",
                "created_at": existing.created_at,
                "completed_at": existing.completed_at,
                "result": existing.result,
            }
        if existing.status in ("queued", "running"):
            return {
                "status": existing.status,
                "fresh": False,
                "run_id": existing.run_id,
                "branch": existing.branch,
                "sha": existing.sha,
                "message": f"Run already {existing.status} for this commit SHA.",
                "created_at": existing.created_at,
            }

    record = run_store.create(
        branch=payload.branch,
        sha=payload.sha,
        scope=payload.scope,
        test_type=payload.test_type,
    )

    from agent.db.supabase import default_intent_store
    from agent.runner.pipeline import run_pipeline

    intents = default_intent_store.get(payload.branch)

    background_tasks.add_task(
        run_pipeline,
        owner="local",
        repo="web",
        branch=payload.branch,
        base_branch="main",
        sha=payload.sha,
        intents=intents,
        run_id=record.run_id,
        scope=payload.scope,
        test_type=payload.test_type,
    )

    return {
        "status": record.status,
        "fresh": True,
        "run_id": record.run_id,
        "branch": record.branch,
        "sha": record.sha,
        "scope": record.scope,
        "test_type": record.test_type,
        "message": "New test run enqueued and dispatched.",
        "created_at": record.created_at,
    }


@router.get("/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    record = run_store.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return record.model_dump()


@router.get("")
async def list_runs(
    branch: str | None = Query(None),
    sha: str | None = Query(None),
) -> list[dict[str, Any]]:
    records = run_store.list_all(branch=branch, sha=sha)
    return [r.model_dump() for r in records]
