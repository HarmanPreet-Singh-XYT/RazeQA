"""Regression tests for the PR-run timeout caused by the first-run baseline refresh.

A PR run against a repository with no recorded baseline used to start an inline
baseline refresh — a second sandbox boot plus a full route sweep — as long as a
fixed 180s remained. That is far less time than the second sweep needs, so the
run blew through ``PIPELINE_TIMEOUT_S`` and was aborted with no report, leaving
the PR's GitHub Check Run ``in_progress`` forever. The refresh must now require
the elapsed sweep time to still be available, and the aborted-run path must
settle the Check Run instead of silently timing out.
"""

from __future__ import annotations

import asyncio
import time

from agent.runner.pipeline import (
    PIPELINE_BASELINE_MIN_BUDGET_S,
    PIPELINE_REPORT_RESERVE_S,
    _baseline_refresh_reserve,
    _deadline_exhausted,
    _notify_run_aborted,
)


def test_reserve_falls_back_to_the_floor_for_a_fast_sweep() -> None:
    assert _baseline_refresh_reserve(time.monotonic()) == PIPELINE_BASELINE_MIN_BUDGET_S


def test_reserve_accounts_for_the_elapsed_sweep() -> None:
    reserve = _baseline_refresh_reserve(time.monotonic() - 600)
    assert reserve >= 600 + PIPELINE_REPORT_RESERVE_S
    assert reserve > PIPELINE_BASELINE_MIN_BUDGET_S


def test_slow_sweep_refuses_a_refresh_that_cannot_finish() -> None:
    """300s left is enough under the old fixed 180s floor but not for a 600s sweep."""

    async def _run() -> None:
        deadline = asyncio.get_running_loop().time() + 300
        # The old rule would have started the second sandbox here.
        assert not _deadline_exhausted(deadline, reserve=PIPELINE_BASELINE_MIN_BUDGET_S)
        # The corrected rule refuses work the run cannot finish.
        reserve = _baseline_refresh_reserve(time.monotonic() - 600)
        assert _deadline_exhausted(deadline, reserve=reserve)

    asyncio.run(_run())


def test_aborted_run_is_a_noop_without_a_pr_or_check_run() -> None:
    asyncio.run(
        _notify_run_aborted(
            owner="acme",
            repo="web",
            sha="a" * 40,
            pr_number=None,
            check_run_id=None,
            installation_id=None,
            post_comments=True,
            message="timed out",
        )
    )


def test_aborted_run_completes_check_run_and_comments(monkeypatch) -> None:
    from agent.github import app as gh

    calls: dict[str, dict] = {}

    class _FakeClient:
        async def update_check_run(self, **kwargs):  # type: ignore[no-untyped-def]
            calls["check"] = kwargs

        async def post_pr_comment(self, **kwargs):  # type: ignore[no-untyped-def]
            calls["comment"] = kwargs

    monkeypatch.setattr(gh, "GitHubAppClient", _FakeClient)

    asyncio.run(
        _notify_run_aborted(
            owner="acme",
            repo="web",
            sha="b" * 40,
            pr_number=7,
            check_run_id=42,
            installation_id=123,
            post_comments=True,
            message="timed out after 900s",
        )
    )

    assert calls["check"]["check_run_id"] == 42
    assert calls["check"]["conclusion"] == "failure"
    assert calls["comment"]["pr_number"] == 7
    assert "timed out" in calls["comment"]["body"]
