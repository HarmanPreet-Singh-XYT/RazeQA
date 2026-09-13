"""Regression tests for the zero-coverage gate.

A run that executed no journeys previously fell through to ``success``, which
meant the engine could post a green GitHub Check Run over a run that verified
nothing at all. These tests pin the three-way outcome and the PR-comment
rendering that accompanies it.
"""

from __future__ import annotations

from agent.analyzer.diff_analyzer import AnalysisResult
from agent.remediation.formatter import generate_pr_summary_comment
from agent.runner.pipeline import decide_overall_status


def test_zero_journeys_is_inconclusive_not_success():
    assert (
        decide_overall_status(
            journeys_executed=0,
            has_new_regressions=False,
            failed_journeys=[],
        )
        == "inconclusive"
    )


def test_zero_journeys_stays_inconclusive_even_with_no_failures():
    # The pre-fix behaviour returned "success" here; that is the bug.
    assert (
        decide_overall_status(
            journeys_executed=0, has_new_regressions=False, failed_journeys=[]
        )
        != "success"
    )


def test_journeys_with_no_failures_is_success():
    assert (
        decide_overall_status(
            journeys_executed=3,
            has_new_regressions=False,
            failed_journeys=[],
        )
        == "success"
    )


def test_failed_journey_is_failure():
    assert (
        decide_overall_status(
            journeys_executed=1,
            has_new_regressions=False,
            failed_journeys=[{"name": "checkout", "error": "boom"}],
        )
        == "failure"
    )


def test_new_regression_is_failure():
    assert (
        decide_overall_status(
            journeys_executed=2,
            has_new_regressions=True,
            failed_journeys=[],
        )
        == "failure"
    )


def test_pr_comment_marks_inconclusive_as_not_a_pass():
    comment = generate_pr_summary_comment(
        status="inconclusive",
        passed_journeys=[],
        failed_journeys=[],
        analysis=AnalysisResult(risk_tag="Low", rationale="No routes discovered."),
        remediation_prompts=[],
    )
    assert "INCONCLUSIVE" in comment
    assert "**not** a pass" in comment
    # A zero-journey run must not render the green success icon.
    assert "✅" not in comment
