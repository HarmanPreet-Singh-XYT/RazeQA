"""On-demand and PR-triggered test run endpoints with SHA-based freshness checking."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger("agent.api.runs")
router = APIRouter(prefix="/runs", tags=["runs"])


def _normalize_artifact_urls(data: dict) -> dict:
    """Converts local filesystem paths for video_url / trace_url stored in a run
    record into browser-fetchable /artifacts/runs/... API URLs. The pipeline
    stores raw local paths in the DB; the API must translate them before
    sending to the client so the video player and trace download links work."""
    from agent.api.artifacts import to_artifact_url

    for field in ("video_url", "trace_url"):
        val = data.get(field)
        if val and not val.startswith("http") and not val.startswith("/artifacts"):
            converted = to_artifact_url(val)
            if converted:
                data[field] = converted

    # Also normalize artifact URLs nested inside the result payload
    result = data.get("result")
    if isinstance(result, dict):
        for field in ("video_url", "trace_url"):
            val = result.get(field)
            if val and not val.startswith("http") and not val.startswith("/artifacts"):
                converted = to_artifact_url(val)
                if converted:
                    result[field] = converted

    return data


class RunRequest(BaseModel):
    branch: str
    sha: str
    repo: str = "default"
    scope: str = "changed"
    test_type: str = "functional"
    force: bool = False
    pr_number: int | None = None
    commit_range: str | None = None


class ExternalRunRequest(BaseModel):
    url: str
    name: str = "external-site"
    test_type: str = "functional"
    routes: list[str] = Field(default_factory=lambda: ["/"])
    credentials: dict[str, str] | None = None
    actions: list[dict[str, Any]] | None = None
    wait: bool = False


class RunRecord(BaseModel):
    run_id: str
    branch: str
    sha: str
    repo: str = "default"
    scope: str = "changed"
    test_type: str = "functional"
    status: str = "queued"  # queued, running, completed, failed, cached
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    completed_at: str | None = None
    result: dict[str, Any] | None = None
    video_url: str | None = None
    trace_url: str | None = None


class RunStore:
    """In-memory run history store for freshness checking and deduplication."""

    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}
        self._lock = threading.Lock()

    def find_latest_by_sha(
        self,
        branch: str,
        sha: str,
        scope: str | None = None,
        test_type: str | None = None,
        repo: str | None = None,
    ) -> RunRecord | None:
        with self._lock:
            matches = [
                r
                for r in self._runs.values()
                if (repo is None or r.repo == repo)
                and r.branch == branch
                and r.sha == sha
                and (scope is None or r.scope == scope)
                and (test_type is None or r.test_type == test_type)
            ]
            if not matches:
                return None
            return max(matches, key=lambda x: x.created_at)

    def create(
        self,
        branch: str,
        sha: str,
        scope: str = "changed",
        test_type: str = "functional",
        repo: str = "default",
    ) -> RunRecord:
        record = RunRecord(
            run_id=f"run_{uuid.uuid4().hex[:12]}",
            repo=repo,
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
        video_url: str | None = None,
        trace_url: str | None = None,
    ) -> RunRecord | None:
        with self._lock:
            record = self._runs.get(run_id)
            if not record:
                return None
            record.status = status
            if result is not None:
                record.result = result
                if video_url is None and "video_url" in result:
                    video_url = result.get("video_url")
                if trace_url is None and "trace_url" in result:
                    trace_url = result.get("trace_url")
            if video_url is not None:
                record.video_url = video_url
            if trace_url is not None:
                record.trace_url = trace_url
            if completed:
                record.completed_at = datetime.now(UTC).isoformat()
            return record


    def list_all(
        self,
        branch: str | None = None,
        sha: str | None = None,
        repo: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[RunRecord]:
        with self._lock:
            items = list(self._runs.values())
            if repo:
                items = [r for r in items if r.repo == repo]
            if branch:
                items = [r for r in items if r.branch == branch]
            if sha:
                items = [r for r in items if r.sha == sha]
            sorted_items = sorted(items, key=lambda x: x.created_at, reverse=True)
            if limit is not None:
                return sorted_items[offset : offset + limit]
            return sorted_items[offset:]

    def clear(self) -> None:
        with self._lock:
            self._runs.clear()


run_store = RunStore()


def _active_store() -> Any:
    try:
        from agent.db.supabase import default_run_store
        return default_run_store
    except (ImportError, AttributeError):
        return run_store


def get_run_store() -> Any:
    return _active_store()


_force_runs_lock = threading.Lock()
_force_runs_history: dict[str, list[float]] = {}


@router.post("")
async def trigger_run(payload: RunRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Trigger an on-demand test run with SHA-based freshness checking.

    If this exact commit SHA was already tested for this branch/scope and force is False,
    returns the cached run result without spinning up a redundant sandbox or spending AI tokens.
    """
    # Rate limit forced test runs (Finding #7)
    if payload.force:
        now = time.time()
        with _force_runs_lock:
            history = _force_runs_history.setdefault(payload.repo, [])
            # Keep only timestamps from the last 60 seconds
            history = [t for t in history if now - t < 60]
            if len(history) >= 10:
                raise HTTPException(
                    status_code=429,
                    detail="Rate limit exceeded: At most 10 forced test runs per minute allowed per repository.",
                )
            history.append(now)
            _force_runs_history[payload.repo] = history

    store = _active_store()
    if not payload.force:
        existing = store.find_latest_by_sha(
            branch=payload.branch,
            sha=payload.sha,
            scope=payload.scope,
            test_type=payload.test_type,
            repo=payload.repo,
        )

        if existing is not None:
            if existing.status in ("completed", "cached"):
                return {
                    "status": "cached",
                    "fresh": False,
                    "run_id": existing.run_id,
                    "repo": existing.repo,
                    "branch": existing.branch,
                    "sha": existing.sha,
                    "scope": existing.scope,
                    "test_type": existing.test_type,
                    "message": "Result returned from cache for this exact commit SHA.",
                    "tokens_saved_estimate": 15000,
                    "cost_saved_usd_estimate": 0.45,
                    "created_at": existing.created_at,
                    "completed_at": existing.completed_at,
                    "result": existing.result,
                }
            if existing.status in ("queued", "running"):
                return {
                    "status": existing.status,
                    "fresh": False,
                    "run_id": existing.run_id,
                    "repo": existing.repo,
                    "branch": existing.branch,
                    "sha": existing.sha,
                    "message": f"Run already {existing.status} for this commit SHA.",
                    "created_at": existing.created_at,
                }

    record = store.create(
        branch=payload.branch,
        sha=payload.sha,
        scope=payload.scope,
        test_type=payload.test_type,
        repo=payload.repo,
    )

    from agent.db.supabase import default_intent_store
    from agent.runner.pipeline import run_pipeline

    intents = default_intent_store.get(payload.branch, repo=payload.repo)

    background_tasks.add_task(
        run_pipeline,
        owner=payload.repo.split("/")[0] if "/" in payload.repo else "local",
        repo=payload.repo.split("/")[1] if "/" in payload.repo else payload.repo,
        branch=payload.branch,
        base_branch="main",
        sha=payload.sha,
        intents=intents,
        run_id=record.run_id,
        scope=payload.scope,
        test_type=payload.test_type,
        pr_number=payload.pr_number,
    )

    return {
        "status": record.status,
        "fresh": True,
        "run_id": record.run_id,
        "repo": record.repo,
        "branch": record.branch,
        "sha": record.sha,
        "scope": record.scope,
        "test_type": record.test_type,
        "message": "New test run enqueued and dispatched.",
        "created_at": record.created_at,
    }


@router.post("/external")
async def trigger_external_run(
    payload: ExternalRunRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """Trigger an autonomous test run against an external, staging, or non-GitHub website."""
    store = _active_store()
    record = store.create(
        branch=payload.name,
        sha=payload.url,
        scope="external",
        test_type=payload.test_type,
        repo="external",
    )

    from agent.runner.external_runner import run_external_pipeline

    if payload.wait:
        result = await run_external_pipeline(
            url=payload.url,
            run_id=record.run_id,
            name=payload.name,
            routes=payload.routes,
            test_type=payload.test_type,
            credentials=payload.credentials,
            actions=payload.actions,
        )
        updated = store.get(record.run_id)
        return updated.model_dump() if updated else {"run_id": record.run_id, "result": result}

    background_tasks.add_task(
        run_external_pipeline,
        url=payload.url,
        run_id=record.run_id,
        name=payload.name,
        routes=payload.routes,
        test_type=payload.test_type,
        credentials=payload.credentials,
        actions=payload.actions,
    )

    return {
        "status": record.status,
        "run_id": record.run_id,
        "url": payload.url,
        "name": payload.name,
        "test_type": payload.test_type,
        "message": "External website test enqueued and dispatched.",
        "created_at": record.created_at,
    }


@router.get("/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    store = _active_store()
    record = store.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _normalize_artifact_urls(record.model_dump())


@router.get("")
async def list_runs(
    branch: str | None = Query(None),
    sha: str | None = Query(None),
    repo: str | None = Query(None),
) -> list[dict[str, Any]]:
    store = _active_store()
    records = store.list_all(branch=branch, sha=sha, repo=repo)
    return [_normalize_artifact_urls(r.model_dump()) for r in records]


@router.post("/{run_id}/apply")
async def apply_run_fix(run_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Apply synthesized code fix proposals from a run and trigger immediate re-verification.

    Works in both GitHub App mode (committing directly to the PR branch via Contents API)
    and Local mode (updating files directly in the repository working tree).
    """
    from pathlib import Path
    from agent.db.supabase import default_intent_store
    from agent.github.app import GitHubAppClient
    from agent.remediation.fix_synthesizer import FilePatch, apply_patch_to_text
    from agent.runner.pipeline import run_pipeline

    store = _active_store()
    record = store.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    result = record.result or {}
    proposals = result.get("fix_proposals", [])
    if not proposals:
        raise HTTPException(
            status_code=400,
            detail=f"No fix proposals found for run {run_id}. Only failed runs with synthesized patches can be applied.",
        )

    applied_files: list[str] = []
    owner = result.get("owner", "local")
    repo = result.get("repo", "web")
    branch = record.branch
    new_sha = record.sha

    github_client = GitHubAppClient()
    # Attempt GitHub Contents API apply if configured
    is_github_ready = (
        github_client.token is not None
        or (github_client.app_id is not None and github_client.private_key is not None)
    ) and owner != "local"

    if is_github_ready:
        for prop in proposals:
            patches = prop.get("patches", [])
            for p in patches:
                try:
                    patch = FilePatch(**p) if isinstance(p, dict) else p
                except ValueError as exc:
                    logger.warning("Skipping unsafe patch from run %s: %s", run_id, exc)
                    continue
                file_info = await github_client.get_file_content(owner, repo, patch.file_path, ref=branch)
                if not file_info or "content" not in file_info:
                    continue
                updated_text, ok = apply_patch_to_text(file_info["content"], patch)
                if ok:
                    commit_res = await github_client.update_file_content(
                        owner=owner,
                        repo=repo,
                        path=patch.file_path,
                        message=f"fix({patch.file_path}): apply autonomous remediation [skip-pr-agent]",
                        content=updated_text,
                        sha=file_info["sha"],
                        branch=branch,
                    )
                    if commit_res and "commit" in commit_res:
                        new_sha = commit_res["commit"].get("sha", new_sha)
                    applied_files.append(patch.file_path)
    else:
        # Local mode: apply to workspace files directly
        # Determine base directory: workspace root or web directory
        candidates = [
            Path.cwd(),
            Path.cwd() / "web",
            Path.cwd().parent,
            Path.cwd().parent / "web",
        ]
        for prop in proposals:
            patches = prop.get("patches", [])
            for p in patches:
                try:
                    patch = FilePatch(**p) if isinstance(p, dict) else p
                except ValueError as exc:
                    logger.warning("Skipping unsafe patch from run %s: %s", run_id, exc)
                    continue
                target_path = None
                for c in candidates:
                    base = c.resolve()
                    candidate_file = (base / patch.file_path).resolve()
                    # Defense in depth: FilePatch already rejects '..'/absolute
                    # paths, but re-verify containment against the resolved
                    # base here since this is the actual filesystem write site.
                    if not candidate_file.is_relative_to(base):
                        continue
                    if candidate_file.exists():
                        target_path = candidate_file
                        break
                if target_path and target_path.is_file():
                    content = target_path.read_text(encoding="utf-8")
                    updated, ok = apply_patch_to_text(content, patch)
                    if ok:
                        target_path.write_text(updated, encoding="utf-8")
                        applied_files.append(patch.file_path)

    # Dispatch re-verification run
    new_record = store.create(
        branch=record.branch,
        sha=new_sha,
        scope=record.scope,
        test_type=record.test_type,
    )

    intents = default_intent_store.get(record.branch)
    background_tasks.add_task(
        run_pipeline,
        owner=owner,
        repo=repo,
        branch=record.branch,
        base_branch="main",
        sha=new_sha,
        intents=intents,
        run_id=new_record.run_id,
        scope=record.scope,
        test_type=record.test_type,
    )

    return {
        "status": "applied",
        "message": f"Successfully applied fix across {len(applied_files)} file(s). Re-verification enqueued.",
        "run_id": run_id,
        "new_run_id": new_record.run_id,
        "applied_files": applied_files,
        "new_sha": new_sha,
    }

