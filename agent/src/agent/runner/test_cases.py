"""Turn a finished run into structured test cases and dismissible findings.

A run used to be reported as two flat lists of journey names. That shape cannot
express *what kind* of scenario ran, how bad a failure is, or how to reproduce
it — which is exactly what a reviewer needs before deciding to merge.

This module is the single place that derives the user-facing structure from the
evidence the pipeline already collected, so the API, the dashboard and the PR
comment cannot disagree about what happened:

* one :class:`TestCase` per executed journey (route or login), carrying status,
  category, severity, impact, reproduction steps, code pointers and the mocks or
  seeded accounts that were active;
* one finding per failure, fingerprinted so a human can dismiss it once and not
  be told about the same issue on every later run.

Nothing here invents a measurement. A field that has no evidence stays ``None``.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Iterable

from agent.analyzer.severity import (
    Severity,
    highest_severity,
    normalize_severity,
    severity_counts,
    severity_from_risk,
)

#: The categories a case can belong to. Kept in one tuple so the dashboard, the
#: API and the docs cannot drift apart.
TEST_CASE_CATEGORIES: tuple[str, ...] = (
    "happy_path",
    "logic",
    "edge",
    "adversarial",
    "accessibility",
    "mobile",
    "visual",
    "navigation",
    # Not a user journey: the application did not build or start, so nothing
    # downstream could be exercised. Reported as one critical case.
    "build",
)

STATUS_PASSED = "passed"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"

#: Where a case stands relative to the base branch / previous run.
ORIGIN_NEW = "new"
ORIGIN_REGRESSION = "regression"
ORIGIN_STILL_BROKEN = "still_broken_verified"
ORIGIN_INHERITED = "still_broken_inherited"
ORIGIN_CARRIED = "carried_forward"
ORIGIN_FIXED = "fixed"

_ACCESSIBILITY_HINTS = ("contrast", "aria", "a11y", "accessib", "keyboard", "tab order", "focus trap")
_MOBILE_HINTS = ("mobile", "viewport", "responsive", "375", "768", "iphone", "android")
_ADVERSARIAL_HINTS = (
    "inject",
    "xss",
    "csrf",
    "sqli",
    "unauthor",
    "forbidden",
    "privilege",
    "permission",
    "tamper",
    "race",
    "bypass",
)
_NAVIGATION_HINTS = ("redirect", "navigation", "broken link", "dead link", "404", "not found")
_EDGE_HINTS = ("empty", "boundary", "max ", "min ", "unicode", "timeout", "null", "overflow", "truncat")
_LOGIC_HINTS = ("expected", "mismatch", "incorrect", "stale", "not persisted", "reverted", "wrong", "silently")


def classify_category(
    name: str,
    route: str | None = None,
    reason: str | None = None,
    *,
    visual: bool = False,
) -> str:
    """Pick the most specific category the evidence supports.

    Order matters: a contrast failure on a mobile viewport is an accessibility
    case, not a mobile one, because that is the actionable label.
    """
    text = f"{name} {route or ''} {reason or ''}".lower()
    if any(hint in text for hint in _ACCESSIBILITY_HINTS):
        return "accessibility"
    if any(hint in text for hint in _MOBILE_HINTS):
        return "mobile"
    if any(hint in text for hint in _ADVERSARIAL_HINTS):
        return "adversarial"
    if any(hint in text for hint in _NAVIGATION_HINTS):
        return "navigation"
    if visual:
        return "visual"
    if any(hint in text for hint in _EDGE_HINTS):
        return "edge"
    if any(hint in text for hint in _LOGIC_HINTS):
        return "logic"
    return "happy_path"


def fingerprint(route: str | None, category: str, message: str) -> str:
    """Stable identity for a finding: same issue, same fingerprint, any run.

    The message is normalized (lowercased, digits and addresses collapsed) so
    that "expected 3 items, got 2" and "expected 5 items, got 1" are treated as
    one recurring finding instead of a new one every run.
    """
    normalized = re.sub(r"\d+", "#", (message or "").lower())
    normalized = re.sub(r"https?://\S+", "<url>", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()[:240]
    digest = hashlib.sha256(f"{route or ''}|{category}|{normalized}".encode()).hexdigest()
    return digest[:32]


def _impact_text(severity: Severity, category: str, route: str | None) -> str:
    where = f" on `{route}`" if route else ""
    if severity is Severity.CRITICAL:
        return f"A core user flow is broken{where}; the application is not usable as-is."
    if severity is Severity.HIGH:
        return f"An important feature is degraded{where}; it should be fixed before merge."
    if severity is Severity.MEDIUM:
        return f"Usability is affected{where}, but the primary goal is still reachable."
    return f"A minor or late-breaking issue{where}; low user impact."


def _reproduction_steps(artifact: dict[str, Any], route: str | None) -> list[str]:
    """Numbered steps from the navigation evidence, not from a template."""
    steps: list[str] = []
    if route:
        steps.append(f"Open {route} in a real browser.")
    for nav in artifact.get("navigation_checks") or []:
        url = nav.get("url") if isinstance(nav, dict) else None
        if not url:
            continue
        if nav.get("navigated"):
            steps.append(f"Click through to {url}.")
        elif nav.get("clicked"):
            steps.append(f"Click the control targeting {url} (it did not navigate).")
        elif nav.get("errored"):
            steps.append(f"Click the control targeting {url} (it raised an error).")
    scrolls = artifact.get("scroll_actions") or 0
    if scrolls:
        steps.append(f"Scroll the page to reveal lazy content ({scrolls} scroll action(s)).")
    links = artifact.get("links_checked") or []
    if links:
        steps.append(f"Follow the {len(links)} internal link(s) checked during the visit.")
    if not steps:
        steps.append("Visit the route and exercise the primary interaction.")
    return steps


def _code_analysis(analysis: Any, route: str | None) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    surfaces = list(getattr(analysis, "affected_surfaces", None) or [])
    for surface in surfaces[:8]:
        entries.append({"surface": str(surface)})
    rationale = getattr(analysis, "rationale", None)
    if rationale:
        entries.append({"note": str(rationale)})
    if route:
        entries.append({"route": route})
    return entries


def _evidence(artifact: dict[str, Any]) -> dict[str, Any]:
    vitals = artifact.get("web_vitals") or {}
    return {
        "video_url": artifact.get("video_url"),
        "trace_url": artifact.get("trace_url"),
        "screenshot_url": artifact.get("annotated_screenshot_url") or artifact.get("screenshot_url"),
        "duration_ms": artifact.get("duration_ms"),
        "console_errors": list(artifact.get("console_errors") or [])[:10],
        "network_requests": len(artifact.get("network_requests") or []),
        "broken_links": list(artifact.get("broken_links") or [])[:10],
        "web_vitals": vitals or None,
    }


def _origin_for(name: str, passed: bool, baseline: dict[str, Any] | None) -> str:
    baseline = baseline or {}
    new_regressions = {str(c.get("journey") or c.get("name")) for c in baseline.get("new_regressions") or []}
    pre_existing = {str(c.get("journey") or c.get("name")) for c in baseline.get("pre_existing_bugs") or []}
    if name in new_regressions:
        return ORIGIN_REGRESSION
    if name in pre_existing:
        return ORIGIN_STILL_BROKEN
    if passed:
        return ORIGIN_NEW
    return ORIGIN_NEW


def case_key(name: str | None, route: str | None) -> str:
    """Identity of a case across runs: its route (or name) plus its name."""
    return f"{route or ''}::{name or ''}"


def _origin_from_history(
    name: str,
    route: str | None,
    passed: bool,
    previous: dict[str, dict[str, Any]],
    baseline: dict[str, Any] | None,
) -> str:
    """Classify origin against the previous run first, then the base branch.

    The previous run is the more precise signal: it knows whether *this exact
    case* passed last time. A case that passed before and fails now is a
    regression, wherever the baseline stands.
    """
    prior = previous.get(case_key(name, route))
    if prior is None:
        return _origin_for(name, passed, baseline)
    prior_passed = prior.get("status") == STATUS_PASSED
    if passed and not prior_passed:
        return ORIGIN_FIXED
    if not passed and prior_passed:
        return ORIGIN_REGRESSION
    if not passed and not prior_passed:
        return ORIGIN_STILL_BROKEN
    return ORIGIN_NEW


def _build_mock_context(seeded_account: str | None, login_enabled: bool) -> list[str]:
    """What the run relied on that a production user would not see.

    Reported so a failure can be judged against its environment. If the run used
    no seeding or mocking, this is empty rather than a hopeful "none".
    """
    context: list[str] = []
    if login_enabled:
        context.append("Authenticated session reused from a seeded login (storage state).")
    if seeded_account:
        context.append(f"Seeded test account: {seeded_account}")
    context.append("External services were not mocked; the run used the live network.")
    return context


def build_test_cases(
    *,
    journey_artifacts: Iterable[dict[str, Any]],
    passed_journeys: Iterable[str],
    failed_journeys: Iterable[dict[str, Any]],
    additional_findings: Iterable[str] | None = None,
    analysis: Any = None,
    baseline_comparison: dict[str, Any] | None = None,
    change_impact: Any = None,
    seeded_account: str | None = None,
    login_enabled: bool = False,
    pr_number: int | None = None,
    previous_cases: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Derive ``(test_cases, findings, severity_summary)`` for a finished run.

    ``previous_cases`` is the previous run's structured output for the same
    branch. It is what makes an incremental report honest: a case that passed
    last time and fails now is a **regression**, one that failed and now passes
    is **fixed**, and a case the diff did not touch is **carried forward** rather
    than silently dropped from the report.
    """
    artifacts = list(journey_artifacts or [])
    passed = set(passed_journeys or [])
    failures: dict[str, dict[str, Any]] = {}
    for fj in failed_journeys or []:
        name = str(fj.get("name") or fj.get("journey") or "unknown")
        failures[name] = fj

    previous_map: dict[str, dict[str, Any]] = {}
    for prior in previous_cases or []:
        key = case_key(prior.get("name"), prior.get("route"))
        previous_map[key] = prior

    risk_severity = severity_from_risk(getattr(analysis, "risk_tag", None))
    mock_context = _build_mock_context(seeded_account, login_enabled)

    # Visual defects are surfaced as additional findings text; tag the matching
    # case as a visual case instead of a generic happy path.
    additional = [str(f) for f in (additional_findings or [])]
    visual_routes = {
        f.split(" on ", 1)[1].split(":", 1)[0].strip()
        for f in additional
        if " on " in f and ("visual" in f.lower() or "contrast" in f.lower())
    }

    cases: list[dict[str, Any]] = []
    for artifact in artifacts:
        name = str(artifact.get("name") or "unknown")
        route = artifact.get("route") or (None if name == "login" else name)
        is_failed = name in failures
        failure = failures.get(name) or {}

        if is_failed:
            severity = normalize_severity(failure.get("severity")) or risk_severity
            reason = str(failure.get("error") or failure.get("reason") or "Journey failed")
            status = STATUS_FAILED
        else:
            severity = None
            reason = None
            status = STATUS_PASSED

        visual = bool(route and route in visual_routes)
        category = classify_category(name, route, reason, visual=visual)
        origin = _origin_from_history(
            name, route, status == STATUS_PASSED, previous_map, baseline_comparison
        )

        case: dict[str, Any] = {
            "name": name,
            "route": route,
            "status": status,
            "category": category,
            "severity": severity.value if severity else None,
            "impact": _impact_text(severity, category, route) if severity else None,
            "failure_reason": reason,
            "reproduction_steps": _reproduction_steps(artifact, route),
            "code_analysis": _code_analysis(analysis, route),
            "mock_context": mock_context,
            "evidence": _evidence(artifact),
            "origin": origin,
            "verified_this_commit": True,
            "pr_number": pr_number,
        }
        cases.append(case)

    # No journeys at all is a "not verified" result, not a silent pass. Record it
    # as one skipped case so the dashboard cannot show an empty green run.
    if not cases:
        rationale = getattr(change_impact, "rationale", None)
        cases.append(
            {
                "name": "no-journeys-executed",
                "route": None,
                "status": STATUS_SKIPPED,
                "category": "happy_path",
                "severity": None,
                "impact": None,
                "failure_reason": rationale or "No routes were discovered or reachable, so nothing was verified.",
                "reproduction_steps": [],
                "code_analysis": _code_analysis(analysis, None),
                "mock_context": mock_context,
                "evidence": {},
                "origin": ORIGIN_NEW,
                "verified_this_commit": True,
                "pr_number": pr_number,
            }
        )

    # Carry forward cases from the previous run that the diff did not touch. They
    # are reported separately and never counted as verified-this-commit, so an
    # inherited failure cannot inflate the signal for a change that did not cause
    # it. They also do not create findings: the finding already exists from the
    # run that actually verified them.
    verified_keys = {
        case_key(c["name"], c["route"])
        for c in cases
        if c["name"] != "no-journeys-executed"
    }
    carried: list[dict[str, Any]] = []
    for prior in previous_cases or []:
        key = case_key(prior.get("name"), prior.get("route"))
        if key in verified_keys:
            continue
        carried.append(
            {
                "name": prior.get("name"),
                "route": prior.get("route"),
                "status": prior.get("status") or STATUS_SKIPPED,
                "category": prior.get("category") or "happy_path",
                "severity": prior.get("severity"),
                "impact": prior.get("impact"),
                "failure_reason": prior.get("failure_reason"),
                "reproduction_steps": prior.get("reproduction_steps") or [],
                "code_analysis": prior.get("code_analysis") or [],
                "mock_context": prior.get("mock_context") or [],
                "evidence": prior.get("evidence") or {},
                "origin": ORIGIN_CARRIED,
                "verified_this_commit": False,
                "pr_number": pr_number,
            }
        )
    cases.extend(carried)

    findings: list[dict[str, Any]] = []
    for case in cases:
        # Only a case actually executed this commit can raise a finding.
        if case["status"] != STATUS_FAILED or not case.get("verified_this_commit", True):
            continue
        message = case["failure_reason"] or f"{case['name']} failed"
        findings.append(
            {
                "fingerprint": fingerprint(case["route"], case["category"], message),
                "severity": case["severity"],
                "category": case["category"],
                "title": f"{case['name']} failed" + (f" on {case['route']}" if case["route"] else ""),
                "detail": message,
                "route": case["route"],
            }
        )

    # Additional findings (visual defects, advisory agent notes) are findings
    # too, but at a lower level: they were observed, not asserted as failures.
    for text in additional:
        route = text.split(" on ", 1)[1].split(":", 1)[0].strip() if " on " in text else None
        category = classify_category("additional", route, text, visual="visual" in text.lower())
        findings.append(
            {
                "fingerprint": fingerprint(route, category, text),
                "severity": Severity.MEDIUM.value if category == "visual" else Severity.LOW.value,
                "category": category,
                "title": text[:120],
                "detail": text,
                "route": route,
            }
        )

    verified = [c for c in cases if c.get("verified_this_commit", True)]
    verified_failures = [c for c in verified if c["status"] == STATUS_FAILED]
    verified_passes = [c for c in verified if c["status"] == STATUS_PASSED]
    failed_severities = [c["severity"] for c in verified_failures]
    highest = highest_severity(failed_severities)
    summary = {
        "counts": severity_counts(failed_severities),
        "highest": highest.value if highest else None,
        "total_cases": len(cases),
        "passed": len(verified_passes),
        "failed": len(verified_failures),
        "skipped": sum(1 for c in verified if c["status"] == STATUS_SKIPPED),
        # Cases the diff did not touch: listed, never counted as verified.
        "carried_forward": len(carried),
        "carried_forward_failing": sum(1 for c in carried if c["status"] == STATUS_FAILED),
        "additional_findings": len(additional),
        # "Passed" requires having verified something: a run that executed no
        # cases is not a pass, even though it has no failures.
        "all_passed": bool(verified_passes) and not verified_failures,
    }
    return cases, findings, summary
