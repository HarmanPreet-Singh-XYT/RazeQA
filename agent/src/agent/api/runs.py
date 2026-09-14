"""On-demand and PR-triggered test run endpoints with SHA-based freshness checking."""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("agent.api.runs")
router = APIRouter(prefix="/runs", tags=["runs"])

# Mirrors the sandbox's `_SAFE_GIT_REF`. Validating here means an unsafe ref is
# rejected with a clear 422 at the API boundary instead of surfacing later as an
# opaque sandbox-boot failure.
_SAFE_BASE_REF = re.compile(r"^[A-Za-z0-9._/@+-]+$")


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
    # Git ref or SHA to diff the tested commit against. When omitted, the diff
    # base is the repository's base branch (``main``). The first-run briefing
    # uses this to express "only the changes in this commit" (``<parent>``) and
    # "the changes across this range" (``<range start>``) without changing which
    # commit is actually built and tested (``sha``).
    base_ref: str | None = None
    # Human-readable label for where this run came from (e.g. "first-run
    # briefing"). Stored on nothing sensitive; used only for display.
    trigger: str | None = None
    # Whether a run on the base branch may redefine the baseline other runs
    # compare against. Only true for a run of the branch as it is now; verifying
    # an older commit or a past range must not overwrite it with stale results.
    update_baseline: bool = True

    @field_validator("base_ref")
    @classmethod
    def _validate_base_ref(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            return None
        if not _SAFE_BASE_REF.match(candidate):
            raise ValueError(
                "base_ref may only contain letters, digits and . _ - / @ +"
            )
        return candidate

    def resolved_base_ref(self) -> str | None:
        """The explicit diff base, accepting ``commit_range`` as a fallback.

        ``a..b`` / ``a...b`` is a range *ending* at the tested commit, so its
        start is the diff base. A bare value is treated as the base itself.
        """
        if self.base_ref and self.base_ref.strip():
            return self.base_ref.strip()
        raw = (self.commit_range or "").strip()
        if not raw:
            return None
        for sep in ("...", ".."):
            if sep in raw:
                start = raw.split(sep, 1)[0].strip()
                return start or None
        return raw or None


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

    def delete_older_than(self, cutoff_iso: str) -> int:
        """Delete in-memory runs created before ``cutoff_iso`` (interface parity
        with SupabaseRunStore; used by the opt-in run-history retention sweep)."""
        try:
            cutoff = datetime.fromisoformat(cutoff_iso.replace("Z", "+00:00"))
        except ValueError:
            return 0

        def _created(rec: RunRecord) -> datetime:
            try:
                return datetime.fromisoformat(rec.created_at.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                return datetime.now(UTC)

        with self._lock:
            expired = [rid for rid, rec in self._runs.items() if _created(rec) < cutoff]
            for rid in expired:
                del self._runs[rid]
        return len(expired)


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
                    # No tokens/cost are reported for a cache hit: the avoided
                    # usage of the run that never happened is not measurable,
                    # and inventing a savings figure would be fabrication.
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
        diff_base=payload.resolved_base_ref(),
        update_baseline=payload.update_baseline,
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
    # The engine host can reach things the caller cannot (cloud instance
    # metadata, internal admin surfaces). Refuse those before a browser is
    # pointed at them.
    from agent.security.url_safety import UnsafeTargetError, validate_external_url

    try:
        payload.url = await validate_external_url(payload.url)
    except UnsafeTargetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Each external run starts a browser session. Cap how often one target can
    # trigger that, so a loop cannot saturate the worker pool.
    from agent.api.rate_limit import external_run_limiter

    retry_after = external_run_limiter.check(payload.name or payload.url)
    if retry_after > 0:
        raise HTTPException(
            status_code=429,
            detail=(
                "Rate limit exceeded: at most 6 external runs per minute per target. "
                f"Retry in {int(retry_after) + 1}s."
            ),
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

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


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict[str, Any]:
    """Cancel a queued or running test run.

    Works for queue-backed jobs (PR / push / bot triggers) and for on-demand
    runs dispatched through FastAPI BackgroundTasks: both register a cancel
    token with the pipeline. The engine stops the sandbox container, aborts the
    browser sweep between actions, and marks the run ``cancelled`` so the
    dashboard does not wait on a run nobody wants anymore.
    """
    store = _active_store()
    record = store.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    if record.status in ("completed", "failed", "cancelled"):
        raise HTTPException(
            status_code=409,
            detail=f"Run {run_id} is already {record.status} and cannot be cancelled.",
        )

    from agent.runner.pipeline import request_run_cancel
    from agent.runner.queue import default_job_queue

    # Cancel at both layers: the queue job (covers a pending job that has not
    # started the pipeline yet) and the pipeline task/cooperative flag (covers
    # a running one). Either may legitimately be a no-op.
    job_cancelled = default_job_queue.cancel_job_by_run(run_id, reason="Cancelled by user")
    run_cancelled = request_run_cancel(run_id, reason="Cancelled by user")

    updated = store.update(
        run_id=run_id,
        status="cancelled",
        result={"status": "cancelled", "error": "Cancelled by user"},
        completed=True,
    )

    logger.info(
        "Cancel requested for run %s (job=%s, live_pipeline=%s)", run_id, job_cancelled, run_cancelled
    )
    return {
        "status": "cancelled",
        "run_id": run_id,
        "job_cancelled": job_cancelled,
        "pipeline_signalled": run_cancelled,
        "message": "Run cancellation requested." if (job_cancelled or run_cancelled) else (
            "Run marked cancelled; no live worker was found for it."
        ),
        "run": updated.model_dump() if updated else None,
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
    owner = result.get("owner") or "local"
    repo = result.get("repo") or "web"
    branch = record.branch
    new_sha = record.sha
    # Needed for GitHub App auth: a JWT alone cannot read repo contents, the
    # App must exchange it for an installation token scoped to this repo.
    installation_id = result.get("installation_id")

    github_client = GitHubAppClient()
    # Attempt the GitHub Contents API only when this run actually came from a
    # real repository and GitHub credentials are configured.
    is_github_ready = (
        github_client.token is not None
        or (github_client.app_id is not None and github_client.private_key is not None)
    ) and owner not in ("", "local", "default", None)

    if is_github_ready:
        for prop in proposals:
            patches = prop.get("patches", [])
            for p in patches:
                try:
                    patch = FilePatch(**p) if isinstance(p, dict) else p
                except ValueError as exc:
                    logger.warning("Skipping unsafe patch from run %s: %s", run_id, exc)
                    continue

                try:
                    # get_file_content returns (text, blob_sha); the previous
                    # code treated that tuple as a dict and skipped every patch.
                    current_text, blob_sha = await github_client.get_file_content(
                        owner,
                        repo,
                        patch.file_path,
                        ref=branch,
                        installation_id=installation_id,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Could not fetch %s from %s/%s@%s for patch application: %s",
                        patch.file_path,
                        owner,
                        repo,
                        branch,
                        exc,
                    )
                    continue

                if not current_text:
                    continue

                updated_text, ok = apply_patch_to_text(current_text, patch)
                if not ok:
                    logger.warning(
                        "Patch for %s did not match the current file contents; skipping.",
                        patch.file_path,
                    )
                    continue

                commit_res = await github_client.update_file_content(
                    owner=owner,
                    repo=repo,
                    path=patch.file_path,
                    message=f"fix({patch.file_path}): apply autonomous remediation [skip-pr-agent]",
                    content=updated_text,
                    sha=blob_sha,
                    branch=branch,
                    installation_id=installation_id,
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

    # Nothing matched the current file contents (or no GitHub credentials /
    # repository identity were available). Report that honestly instead of
    # claiming "applied" with an empty file list, and do not burn a
    # re-verification run on an unchanged tree.
    if not applied_files:
        return JSONResponse(
            status_code=409,
            content={
                "status": "no_changes_applied",
                "run_id": run_id,
                "applied_files": [],
                "applied_via": "none",
                "error": (
                    "No patch could be applied: the synthesized fix did not match the "
                    "current contents of any target file"
                    + (
                        " and this run is not associated with a GitHub repository."
                        if not is_github_ready
                        else "."
                    )
                    + " Re-run verification to regenerate a fix."
                ),
            },
        )

    # Dispatch re-verification run against the updated revision only once a
    # change actually landed.
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
        installation_id=installation_id,
    )

    applied_via = "github_contents_api" if is_github_ready else "local_worktree"
    return {
        "status": "applied",
        "message": (
            f"Applied fix to {len(applied_files)} file(s) via {applied_via}. "
            "Re-verification enqueued."
        ),
        "run_id": run_id,
        "new_run_id": new_record.run_id,
        "applied_files": applied_files,
        "applied_via": applied_via,
        "new_sha": new_sha,
    }

