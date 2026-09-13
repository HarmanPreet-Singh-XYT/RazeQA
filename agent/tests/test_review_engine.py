"""Tests for the three-lane review engine: isolation, parsing, ranking."""

from __future__ import annotations

import json
import threading
import time

from agent.review.engine import (
    ReviewEngine,
    dedupe_findings,
    extract_json,
    parse_lane_output,
)
from agent.review.models import Lane, ReviewFinding

DIFF = """diff --git a/src/auth.py b/src/auth.py
--- a/src/auth.py
+++ b/src/auth.py
@@ -10,4 +10,7 @@ def login(user, pw):
     if not user:
         return None
+    token = db.query(f"SELECT * FROM users WHERE pw='{pw}'")
+    log.info("login %s %s", user, pw)
+    pristine = True
     return check(user, pw)
"""


def test_extract_json_handles_fences_and_prose():
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! Here you go:\n```\n{"a": 1}\n```\nHope that helps.') == {"a": 1}
    assert extract_json('no json here') is None
    assert extract_json("") is None


def test_parse_lane_output_drops_unanchored_findings():
    """A finding that cites neither a file nor a snippet is noise, not a finding."""
    raw = json.dumps(
        {
            "summary": "ok",
            "findings": [
                {"tier": "must_fix", "title": "Anchored by file", "file": "src/auth.py", "line": 11},
                {"tier": "must_fix", "title": "Anchored by evidence", "evidence": "return None"},
                {"tier": "must_fix", "title": "No anchor at all"},
                {"tier": "must_fix"},
            ],
        }
    )
    findings, summary = parse_lane_output(raw, Lane.SECURITY)
    assert summary == "ok"
    assert [f.title for f in findings] == ["Anchored by file", "Anchored by evidence"]


def test_parse_lane_output_tolerates_aliases_and_bad_entries():
    raw = json.dumps(
        {
            "issues": [
                {"severity": "high", "summary": "Aliased", "path": "a.py", "line_number": 4},
                "not a dict",
                {"title": "bad line", "path": "b.py", "line": "not-a-number"},
            ]
        }
    )
    findings, _ = parse_lane_output(raw, Lane.CODE_REVIEW)
    assert findings[0].title == "Aliased"
    assert findings[0].tier == "must_fix"
    assert findings[0].file == "a.py"
    assert findings[0].line == 4
    assert findings[1].line is None


def test_parse_lane_output_caps_findings():
    raw = json.dumps({"findings": [{"title": f"f{i}", "file": "a.py"} for i in range(20)]})
    findings, _ = parse_lane_output(raw, Lane.SECURITY, max_findings=3)
    assert len(findings) == 3


def test_parse_lane_output_handles_bare_list_and_garbage():
    findings, _ = parse_lane_output('[{"title": "t", "file": "a.py"}]', Lane.SECURITY)
    assert len(findings) == 1
    assert parse_lane_output("total nonsense", Lane.SECURITY) == ([], "")


def test_review_runs_lanes_concurrently():
    """The three lanes are independent model calls and must not be serialised."""
    seen: list[Lane] = []
    lock = threading.Lock()

    def invoker(lane, system, user):
        with lock:
            seen.append(lane)
        time.sleep(0.15)
        return '{"findings": []}'

    engine = ReviewEngine(invoker=invoker, max_workers=3)
    started = time.monotonic()
    report = engine.review(DIFF)
    elapsed = time.monotonic() - started

    assert len(report.lanes) == 3
    # Serialised this would take ~0.45s; concurrent it is ~0.15s.
    assert elapsed < 0.35
    assert set(seen) == set(Lane)


def test_one_lane_failing_does_not_lose_the_others():
    def invoker(lane, system, user):
        if lane is Lane.CODE_REVIEW:
            raise RuntimeError("provider unavailable")
        if lane is Lane.SECURITY:
            return json.dumps(
                {
                    "findings": [
                        {
                            "tier": "must_fix",
                            "title": "SQL injection",
                            "file": "src/auth.py",
                            "line": 11,
                            "evidence": "db.query(f\"...{pw}\")",
                        }
                    ]
                }
            )
        return '{"findings": []}'

    report = ReviewEngine(invoker=invoker).review(DIFF)
    by_lane = {r.lane: r for r in report.lanes}
    assert by_lane[Lane.CODE_REVIEW].status == "error"
    assert "provider unavailable" in by_lane[Lane.CODE_REVIEW].error
    assert len(report.findings) == 1
    assert report.findings[0].title == "SQL injection"


def test_introduced_flag_marks_inherited_code():
    """A finding on a line the PR did not add is reported as pre-existing."""

    def invoker(lane, system, user):
        if lane is not Lane.SECURITY:
            return '{"findings": []}'
        return json.dumps(
            {
                "findings": [
                    {"tier": "must_fix", "title": "New problem", "file": "src/auth.py", "line": 12},
                    {"tier": "should_fix", "title": "Old problem", "file": "src/auth.py", "line": 10},
                ]
            }
        )

    report = ReviewEngine(invoker=invoker).review(DIFF)
    by_title = {f.title: f for f in report.findings}
    assert by_title["New problem"].introduced is True
    assert by_title["Old problem"].introduced is False
    assert [f.title for f in report.introduced_findings] == ["New problem"]


def test_cross_lane_annotation():
    """Two lanes landing on the same location are cross-referenced, not merged."""
    payload = {
        Lane.SECURITY: '{"findings":[{"tier":"must_fix","title":"Logs credentials","file":"src/auth.py","line":12,"evidence":"log.info"}]}',
        Lane.COMPLIANCE: '{"findings":[{"tier":"must_fix","title":"Password in logs","file":"src/auth.py","line":12,"evidence":"log.info"}]}',
        Lane.CODE_REVIEW: '{"findings":[]}',
    }
    report = ReviewEngine(invoker=lambda lane, s, u: payload[lane]).review(DIFF)
    assert len(report.findings) == 2
    for finding in report.findings:
        assert finding.also_raised_by == [
            "compliance" if finding.lane is Lane.SECURITY else "security"
        ]


def test_ranking_puts_severe_and_introduced_first():
    def invoker(lane, system, user):
        if lane is not Lane.SECURITY:
            return '{"findings": []}'
        return json.dumps(
            {
                "findings": [
                    {"tier": "suggestion", "title": "Nit", "file": "src/auth.py", "line": 11},
                    {"tier": "must_fix", "title": "Inherited serious", "file": "src/auth.py", "line": 10},
                    {"tier": "must_fix", "title": "Introduced serious", "file": "src/auth.py", "line": 12},
                ]
            }
        )

    report = ReviewEngine(invoker=invoker).review(DIFF)
    ranked = report.ranked()
    assert ranked[0].title == "Introduced serious"
    assert ranked[1].title == "Inherited serious"
    assert ranked[-1].title == "Nit"
    assert report.blocking is False


def test_dedupe_keeps_the_more_severe_copy():
    findings = [
        ReviewFinding(lane=Lane.SECURITY, tier="suggestion", title="Same wording here", file="a.py"),
        ReviewFinding(lane=Lane.SECURITY, tier="must_fix", title="Same wording here", file="a.py"),
    ]
    assert findings[0].fingerprint == findings[1].fingerprint
    deduped = dedupe_findings(findings)
    assert len(deduped) == 1
    assert deduped[0].tier == "must_fix"


def test_lane_request_subset_is_respected():
    calls: list[Lane] = []
    report = ReviewEngine(
        invoker=lambda lane, s, u: (calls.append(lane), '{"findings": []}')[1]
    ).review(DIFF, lanes=[Lane.SECURITY])
    assert calls == [Lane.SECURITY]
    assert [r.lane for r in report.lanes] == [Lane.SECURITY]
