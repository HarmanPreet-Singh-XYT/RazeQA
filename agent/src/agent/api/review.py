"""HTTP surface for the three-lane review and the on-demand verified fixer.

Two endpoints carry the product story:

* ``POST /review/analyze`` runs compliance, security and code review over a diff
  and returns the merged report plus each lane's own markdown message;
* ``POST /review/fix`` is the button. It takes one finding, runs best-of-N
  candidates in a sandbox, and returns an outcome that is *verified or empty* —
  plus, only when explicitly asked, a branch and a pull request.

``repo_dir`` is a server-side path, so it is confined to an allowlist of roots
(``REVIEW_ALLOWED_ROOTS``, defaulting to the working directory) rather than
accepting any path the caller names.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from agent.review.diff import collect_diff, parse_unified_diff
from agent.review.engine import ReviewEngine
from agent.review.fixer import ScriptedCandidateGenerator, VerifiedFixEngine
from agent.review.models import LANE_LABELS, LANE_TIERS, Lane, ReviewFinding
from agent.review.render import (
    render_fix_markdown,
    render_lane_markdown,
    render_report_markdown,
    report_to_json,
)

logger = logging.getLogger("agent.review.api")
router = APIRouter(prefix="/review", tags=["review"])


class AnalyzeRequest(BaseModel):
    """Either supply a diff directly, or point at a checkout and a ref range."""

    repo: str = "default"
    diff: str | None = None
    repo_dir: str | None = None
    base_ref: str | None = None
    head_ref: str | None = None
    title: str = ""
    description: str = ""
    conventions: str = ""
    lanes: list[Lane] | None = None
    max_findings_per_lane: int = Field(default=10, ge=1, le=50)


class AnalyzeResponse(BaseModel):
    report: dict[str, Any]
    lane_markdown: dict[str, str]
    report_markdown: str


class FixRequest(BaseModel):
    """The button payload: one finding, and optionally publish the result."""

    finding: ReviewFinding
    repo_dir: str
    attempts: int = Field(default=3, ge=1, le=10)
    test_command: str = ""
    suite_command: str = ""
    build_command: str = ""
    publish: bool = False
    base_ref: str | None = None
    # Only used when ``publish`` is true and a pull request should be opened.
    owner: str | None = None
    repo_full_name: str | None = None
    installation_id: int | None = None


def _allowed_roots() -> list[Path]:
    raw = os.environ.get("REVIEW_ALLOWED_ROOTS", "").strip()
    if raw:
        candidates = [Path(p).expanduser().resolve() for p in raw.split(os.pathsep) if p.strip()]
    else:
        candidates = [Path.cwd().resolve()]
    return candidates


def _validate_repo_dir(repo_dir: str) -> Path:
    """Confine ``repo_dir`` to a configured root and require a real git checkout."""
    try:
        resolved = Path(repo_dir).expanduser().resolve()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid repo_dir: {exc}") from exc

    roots = _allowed_roots()
    if not any(resolved == root or root in resolved.parents for root in roots):
        raise HTTPException(
            status_code=403,
            detail=(
                "repo_dir is outside the allowed roots. Set REVIEW_ALLOWED_ROOTS to a "
                "colon-separated list of directories the review engine may operate on."
            ),
        )
    if not resolved.is_dir():
        raise HTTPException(status_code=404, detail=f"repo_dir does not exist: {resolved}")
    if not (resolved / ".git").exists():
        raise HTTPException(status_code=422, detail=f"repo_dir is not a git checkout: {resolved}")
    return resolved


@router.get("/lanes")
async def list_lanes() -> dict[str, Any]:
    """The three lanes and their severity ladders, for the dashboard to render."""
    return {
        "lanes": [
            {
                "lane": lane.value,
                "label": LANE_LABELS[lane],
                "tiers": [
                    {
                        "key": tier.key,
                        "label": tier.label,
                        "severity": tier.severity.value,
                        "description": tier.description,
                    }
                    for tier in LANE_TIERS[lane]
                ],
            }
            for lane in LANE_TIERS
        ]
    }


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """Run the three lanes over one diff."""
    diff = request.diff
    if not diff:
        if not request.repo_dir:
            raise HTTPException(status_code=422, detail="supply either `diff` or `repo_dir`")
        repo_dir = _validate_repo_dir(request.repo_dir)
        base = request.base_ref or "main"
        head = request.head_ref or "HEAD"
        diff = await run_in_threadpool(collect_diff, repo_dir, base, head)
        if not diff.strip():
            raise HTTPException(
                status_code=404,
                detail=f"no changes found between {base} and {head} in {repo_dir}",
            )

    index = parse_unified_diff(diff)
    engine = ReviewEngine(max_findings_per_lane=request.max_findings_per_lane)
    report = await run_in_threadpool(
        engine.review,
        diff,
        repo=request.repo,
        base_ref=request.base_ref,
        head_ref=request.head_ref,
        title=request.title,
        description=request.description,
        conventions=request.conventions,
        lanes=request.lanes,
        index=index,
    )
    report_json = report_to_json(report)

    # Notify a real repository's watchers. A review of an ad-hoc diff carries
    # repo="default", which has no project to resolve recipients from, so it is
    # skipped rather than mailed to the deployment-wide inbox alone.
    if request.repo and request.repo != "default":
        try:
            from agent.email.notifications import notify_review_completed

            await notify_review_completed(
                repo=request.repo, report=report_json, head_ref=request.head_ref
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not send review-completed notification: %s", exc)

    return AnalyzeResponse(
        report=report_json,
        lane_markdown={
            lane_report.lane.value: render_lane_markdown(
                lane_report, repo=report.repo, head_ref=report.head_ref
            )
            for lane_report in report.lanes
        },
        report_markdown=render_report_markdown(report),
    )


@router.post("/fix")
async def fix(request: FixRequest) -> dict[str, Any]:
    """Run the on-demand verified fix for one finding.

    The candidate generator is injected rather than hard-wired: the LLM repair
    agent needs provider credentials, and this endpoint must still be usable
    (and testable) without them. Set ``REVIEW_FIX_GENERATOR=miniswe`` to use the
    real agent; the default returns a clear error rather than an unverified patch.
    """
    repo_dir = _validate_repo_dir(request.repo_dir)

    generator_mode = os.environ.get("REVIEW_FIX_GENERATOR", "miniswe").strip().lower()
    generator: Any
    if generator_mode == "miniswe":
        from agent.review.generators import MiniSweCandidateGenerator

        generator = MiniSweCandidateGenerator(
            repo_dir,
            test_command=request.test_command,
            suite_command=request.suite_command,
            build_command=request.build_command,
        )
    elif generator_mode == "scripted":
        generator = ScriptedCandidateGenerator([])
    else:
        raise HTTPException(status_code=500, detail=f"unknown REVIEW_FIX_GENERATOR: {generator_mode}")

    engine = VerifiedFixEngine(generator)
    outcome = await run_in_threadpool(
        engine.fix,
        request.finding,
        _make_sandbox(repo_dir),
        attempts=request.attempts,
        test_command=request.test_command,
        suite_command=request.suite_command,
        build_command=request.build_command,
    )

    payload: dict[str, Any] = {
        "outcome": outcome.to_dict(),
        "verified": outcome.verified,
        "markdown": render_fix_markdown(outcome),
    }

    if request.publish and outcome.verified:
        from agent.review.publish import FixPublisher, PublishError

        publisher = FixPublisher(repo_dir)
        try:
            published = await run_in_threadpool(
                publisher.commit, outcome, base_ref=request.base_ref
            )
        except PublishError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        payload["published"] = {
            "branch": published.branch,
            "base_ref": published.base_ref,
            "commit_sha": published.commit_sha,
            "files": published.files,
        }
        if request.owner and request.repo_full_name:
            pr_url = await publisher.open_pull_request(
                published,
                owner=request.owner,
                repo=request.repo_full_name,
                outcome=outcome,
                installation_id=request.installation_id,
            )
            payload["published"]["pr_url"] = pr_url

        # Announce only what actually became reviewable: a branch, and at most a
        # pull request. Best-effort, like every other notification.
        try:
            from agent.email.notifications import notify_fix_published

            await notify_fix_published(
                repo_full_name=request.repo_full_name or request.owner,
                branch=published.branch,
                pr_url=payload["published"].get("pr_url"),
                finding_title=getattr(request.finding, "title", None),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not send fix-published notification: %s", exc)

    return payload


def _make_sandbox(repo_dir: Path):
    """A throwaway clone the candidate patches are applied and verified in."""
    from agent.review.fixer import LocalGitSandbox

    return LocalGitSandbox(repo_dir)
