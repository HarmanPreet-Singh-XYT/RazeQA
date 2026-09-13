"""Tests for the three-lane severity ladders and finding identity."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agent.analyzer.severity import Severity
from agent.review.models import (
    LANE_TIERS,
    Lane,
    ReviewFinding,
    fingerprint_finding,
    resolve_tier,
)


def test_each_lane_keeps_its_own_ladder():
    """The ladders genuinely differ: compliance has `critical`, the others do not,
    and compliance has no `suggestion` rung."""
    assert [t.key for t in LANE_TIERS[Lane.COMPLIANCE]] == ["critical", "must_fix", "should_fix"]
    assert [t.key for t in LANE_TIERS[Lane.SECURITY]] == ["must_fix", "should_fix", "suggestion"]
    assert [t.key for t in LANE_TIERS[Lane.CODE_REVIEW]] == ["must_fix", "should_fix", "suggestion"]


def test_tier_maps_to_canonical_severity():
    assert resolve_tier(Lane.COMPLIANCE, "critical")[0].severity is Severity.CRITICAL
    assert resolve_tier(Lane.COMPLIANCE, "must_fix")[0].severity is Severity.HIGH
    assert resolve_tier(Lane.SECURITY, "must_fix")[0].severity is Severity.HIGH
    assert resolve_tier(Lane.SECURITY, "suggestion")[0].severity is Severity.LOW


def test_tier_aliases_are_normalised_per_lane():
    """Models drift between `priority`, `severity` and `must-fix` spellings."""
    tier, inferred = resolve_tier(Lane.SECURITY, "Must-Fix")
    assert tier.key == "must_fix" and inferred is False

    tier, inferred = resolve_tier(Lane.CODE_REVIEW, "  HIGH  ")
    assert tier.key == "must_fix" and inferred is False

    # A security lane never emits `critical` itself, but a model may: it belongs
    # on the top rung of that lane's ladder rather than being dropped.
    tier, inferred = resolve_tier(Lane.SECURITY, "critical")
    assert tier.key == "must_fix" and inferred is False


def test_unknown_tier_lands_on_lightest_rung_and_is_flagged():
    """An unparseable tier must not silently become a high-severity finding."""
    tier, inferred = resolve_tier(Lane.SECURITY, "banana")
    assert tier.key == "suggestion"
    assert inferred is True


def test_severity_is_derived_from_tier_not_from_model_adjective():
    """A model calling a low-impact issue `critical` picks the top rung — it does
    not get to invent a new one."""
    finding = ReviewFinding(
        lane=Lane.SECURITY,
        tier="critical",
        title="Long line",
        file="src/app.py",
        line=3,
    )
    assert finding.tier == "must_fix"
    assert finding.severity is Severity.HIGH


def test_finding_fingerprint_is_stable_across_line_moves():
    """Same issue, new line number, same identity — otherwise every rebase looks
    like a brand-new finding."""
    first = fingerprint_finding(Lane.SECURITY, "src/a.py", "SQL injection in login", "pw interpolated")
    second = fingerprint_finding(Lane.SECURITY, "src/a.py", "SQL injection in login", "pw interpolated")
    assert first == second

    # Digits are collapsed so "expected 3, got 2" and "expected 5, got 1" are one
    # recurring defect rather than two.
    a = fingerprint_finding(Lane.CODE_REVIEW, "src/a.py", "expected 3 items but got 2")
    b = fingerprint_finding(Lane.CODE_REVIEW, "src/a.py", "expected 5 items but got 1")
    assert a == b


def test_finding_fingerprint_separates_lanes_and_paths():
    base = fingerprint_finding(Lane.SECURITY, "src/a.py", "Missing check")
    assert base != fingerprint_finding(Lane.CODE_REVIEW, "src/a.py", "Missing check")
    assert base != fingerprint_finding(Lane.SECURITY, "src/b.py", "Missing check")


def test_finding_defaults_to_tier_inferred_false_when_explicit():
    finding = ReviewFinding(lane=Lane.CODE_REVIEW, tier="should_fix", title="X", file="a.py")
    assert finding.tier_inferred is False
    assert finding.severity is Severity.MEDIUM


def test_location_and_evidence_helpers():
    finding = ReviewFinding(
        lane=Lane.CODE_REVIEW, tier="must_fix", title="X", file="a.py", line=9, evidence="  "
    )
    assert finding.location == "a.py:9"
    assert finding.has_evidence is False

    no_line = ReviewFinding(lane=Lane.CODE_REVIEW, tier="must_fix", title="X", file="a.py")
    assert no_line.location == "a.py"


def test_invalid_confidence_is_rejected():
    with pytest.raises(ValidationError):
        ReviewFinding(lane=Lane.CODE_REVIEW, tier="must_fix", title="X", confidence=1.4)
