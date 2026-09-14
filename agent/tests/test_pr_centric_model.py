"""Tests for the PR-centric result model: severity, test cases, findings,
per-repository automation policy, and the external-target guard.
"""

from __future__ import annotations

import asyncio
import socket

import pytest

from agent.analyzer.severity import (
    Severity,
    highest_severity,
    normalize_severity,
    severity_counts,
    severity_from_risk,
    severity_rank,
)
from agent.projects.automation import (
    AutomationSettings,
    DEFAULT_AUTOMATION,
    is_bot_author,
    parse_automation,
    should_review,
)
from agent.runner.test_cases import (
    ORIGIN_CARRIED,
    ORIGIN_FIXED,
    ORIGIN_REGRESSION,
    ORIGIN_STILL_BROKEN,
    build_test_cases,
    classify_category,
    fingerprint,
)
from agent.security.url_safety import UnsafeTargetError, _validate_syntax, validate_external_url


@pytest.fixture(autouse=True)
def _guard_is_enabled(monkeypatch):
    """These tests assert the default (guarded) behaviour, so the self-hosted
    opt-in must not be inherited from another suite."""
    monkeypatch.delenv("ALLOW_PRIVATE_EXTERNAL_TARGETS", raising=False)


# ---------------------------------------------------------------------------
# Severity taxonomy
# ---------------------------------------------------------------------------

def test_severity_aliases_normalize_to_four_levels():
    assert normalize_severity("Critical") is Severity.CRITICAL
    assert normalize_severity("warning") is Severity.MEDIUM
    assert normalize_severity("optimization") is Severity.LOW
    assert normalize_severity("sev1") is Severity.CRITICAL
    assert normalize_severity("severity: high") is Severity.HIGH


def test_unknown_severity_is_not_guessed():
    assert normalize_severity("banana") is None
    assert normalize_severity(None) is None
    assert normalize_severity("banana", Severity.MEDIUM) is Severity.MEDIUM


def test_highest_severity_and_counts():
    values = ["low", "high", "medium", None, "nonsense"]
    assert highest_severity(values) is Severity.HIGH
    counts = severity_counts(values)
    assert counts == {"critical": 0, "high": 1, "medium": 1, "low": 1}


def test_severity_rank_sorts_unknown_last():
    assert severity_rank("critical") < severity_rank("low")
    assert severity_rank("unknown-xyz") > severity_rank("low")


def test_risk_tag_maps_unknown_to_medium():
    assert severity_from_risk("High") is Severity.HIGH
    assert severity_from_risk(None) is Severity.MEDIUM


# ---------------------------------------------------------------------------
# Test case / finding construction
# ---------------------------------------------------------------------------

class _Analysis:
    affected_surfaces = ["app/checkout/page.tsx"]
    risk_tag = "High"
    rationale = "Payments path touched."


def _artifact(name: str, route: str, *, navigated: bool = False) -> dict:
    return {
        "name": name,
        "route": route,
        "video_url": "/artifacts/runs/x/video.mp4",
        "trace_url": "/artifacts/runs/x/trace.zip",
        "duration_ms": 1500.0,
        "console_errors": [],
        "network_requests": [{"url": "https://example.com"}],
        "navigation_checks": [
            {"url": "https://example.com/cart", "clicked": True, "navigated": navigated, "errored": False}
        ],
        "links_checked": [{"url": "/a"}, {"url": "/b"}],
        "broken_links": [],
        "web_vitals": {"lcp_ms": 1200.0},
    }


def test_passing_case_has_no_severity_and_real_steps():
    cases, findings, summary = build_test_cases(
        journey_artifacts=[_artifact("exploratory:/", "/")],
        passed_journeys=["exploratory:/"],
        failed_journeys=[],
        analysis=_Analysis(),
    )
    assert len(cases) == 1
    case = cases[0]
    assert case["status"] == "passed"
    assert case["severity"] is None
    assert case["impact"] is None
    assert findings == []
    assert summary["all_passed"] is True
    assert summary["counts"] == {"critical": 0, "high": 0, "medium": 0, "low": 0}
    # Reproduction steps come from the real navigation evidence.
    assert any("/cart" in step for step in case["reproduction_steps"])
    assert any("link" in step for step in case["reproduction_steps"])


def test_failing_case_carries_severity_evidence_and_finding():
    cases, findings, summary = build_test_cases(
        journey_artifacts=[_artifact("exploratory:/checkout", "/checkout", navigated=True)],
        passed_journeys=[],
        failed_journeys=[
            {"name": "exploratory:/checkout", "error": "Checkout button did nothing", "severity": "Critical"}
        ],
        analysis=_Analysis(),
        seeded_account="qa@example.com",
    )
    case = cases[0]
    assert case["status"] == "failed"
    assert case["severity"] == "critical"
    assert case["impact"]
    assert case["evidence"]["video_url"].endswith(".mp4")
    assert case["verified_this_commit"] is True
    # Mock context is disclosed so a failure can be judged against its environment.
    assert any("qa@example.com" in line for line in case["mock_context"])
    assert summary["failed"] == 1
    assert summary["counts"]["critical"] == 1
    assert len(findings) == 1
    assert findings[0]["severity"] == "critical"
    assert findings[0]["fingerprint"]


def test_no_journeys_is_a_skipped_case_not_a_silent_pass():
    cases, _findings, summary = build_test_cases(
        journey_artifacts=[],
        passed_journeys=[],
        failed_journeys=[],
        analysis=_Analysis(),
    )
    assert len(cases) == 1
    assert cases[0]["status"] == "skipped"
    assert summary["all_passed"] is False
    assert summary["skipped"] == 1


def test_baseline_categories_set_origin():
    cases, _, _ = build_test_cases(
        journey_artifacts=[_artifact("exploratory:/a", "/a"), _artifact("exploratory:/b", "/b")],
        passed_journeys=[],
        failed_journeys=[
            {"name": "exploratory:/a", "error": "broke", "severity": "High"},
            {"name": "exploratory:/b", "error": "already broken", "severity": "High"},
        ],
        analysis=_Analysis(),
        baseline_comparison={
            "has_new_regressions": True,
            "new_regressions": [{"journey": "exploratory:/a"}],
            "pre_existing_bugs": [{"journey": "exploratory:/b"}],
        },
    )
    by_name = {c["name"]: c for c in cases}
    assert by_name["exploratory:/a"]["origin"] == ORIGIN_REGRESSION
    assert by_name["exploratory:/b"]["origin"] == ORIGIN_STILL_BROKEN


def test_previous_run_classifies_regression_and_fixed():
    previous = [
        {"name": "exploratory:/cart", "route": "/cart", "status": "passed"},
        {
            "name": "exploratory:/checkout",
            "route": "/checkout",
            "status": "failed",
            "severity": "high",
            "category": "logic",
            "failure_reason": "old checkout failure",
        },
        {
            "name": "exploratory:/pricing",
            "route": "/pricing",
            "status": "failed",
            "severity": "medium",
            "category": "visual",
            "failure_reason": "old pricing layout",
        },
    ]
    cases, findings, summary = build_test_cases(
        journey_artifacts=[
            _artifact("exploratory:/cart", "/cart"),
            _artifact("exploratory:/checkout", "/checkout"),
        ],
        passed_journeys=["exploratory:/checkout"],
        failed_journeys=[{"name": "exploratory:/cart", "error": "cart broke", "severity": "High"}],
        analysis=_Analysis(),
        previous_cases=previous,
    )
    by_name = {c["name"]: c for c in cases}
    # Passed last run, fails now -> regression.
    assert by_name["exploratory:/cart"]["origin"] == ORIGIN_REGRESSION
    # Failed last run, passes now -> fixed.
    assert by_name["exploratory:/checkout"]["origin"] == ORIGIN_FIXED
    # Not re-run this commit -> carried forward, not verified.
    pricing = by_name["exploratory:/pricing"]
    assert pricing["origin"] == ORIGIN_CARRIED
    assert pricing["verified_this_commit"] is False

    # Only the verified failure counts and raises a finding.
    assert summary["failed"] == 1
    assert summary["counts"]["high"] == 1
    assert summary["carried_forward"] == 1
    assert summary["carried_forward_failing"] == 1
    assert all(f["route"] != "/pricing" for f in findings)


def test_fingerprint_is_stable_across_numeric_detail():
    a = fingerprint("/checkout", "logic", "Expected 3 items but got 2")
    b = fingerprint("/checkout", "logic", "Expected 8 items but got 5")
    assert a == b
    # A different route is a different finding.
    assert fingerprint("/cart", "logic", "Expected 3 items but got 2") != a


def test_category_classification_prefers_specific_labels():
    assert classify_category("exploratory:/x", "/x", "contrast ratio below 3:1") == "accessibility"
    assert classify_category("exploratory:/x", "/x", "mobile viewport overflow") == "mobile"
    assert classify_category("exploratory:/x", "/x", "possible SQLi injection accepted") == "adversarial"
    assert classify_category("exploratory:/x", "/x", "link 404 not found") == "navigation"
    assert classify_category("exploratory:/x", "/x", "empty input accepted") == "edge"
    assert classify_category("exploratory:/x", "/x", "value not persisted") == "logic"
    assert classify_category("exploratory:/x", "/x", "nothing unusual") == "happy_path"


def test_additional_findings_become_low_or_medium_findings():
    _cases, findings, summary = build_test_cases(
        journey_artifacts=[_artifact("exploratory:/", "/")],
        passed_journeys=["exploratory:/"],
        failed_journeys=[],
        additional_findings=["Visual defect on /pricing: overlapping text"],
        analysis=_Analysis(),
    )
    assert len(findings) == 1
    assert findings[0]["severity"] == "medium"
    assert findings[0]["category"] == "visual"
    assert summary["additional_findings"] == 1


# ---------------------------------------------------------------------------
# Automation policy
# ---------------------------------------------------------------------------

def test_automation_defaults_and_parsing():
    assert parse_automation(None) == DEFAULT_AUTOMATION
    assert parse_automation({}) == DEFAULT_AUTOMATION
    policy = parse_automation({"automation": {"mode": "silent", "draft_prs": True, "comments": False}})
    assert policy.mode == "silent"
    assert policy.draft_prs is True
    assert policy.comments is False
    assert policy.posts_to_github is False
    # An unknown mode falls back to active rather than disabling reviews.
    assert parse_automation({"automation": {"mode": "nonsense"}}).mode == "active"


def test_should_review_gates_drafts_bots_and_pause():
    assert should_review(DEFAULT_AUTOMATION, is_draft=False, author_type="User", author_login="ada")[0]
    assert should_review(DEFAULT_AUTOMATION, is_draft=True, author_type="User", author_login="ada") == (
        False,
        "draft_prs_disabled",
    )
    assert should_review(DEFAULT_AUTOMATION, is_draft=False, author_type="Bot", author_login="dependabot[bot]")[0]
    no_bots = AutomationSettings(bot_prs=False)
    assert should_review(no_bots, is_draft=False, author_type="Bot", author_login="renovate[bot]") == (
        False,
        "bot_prs_disabled",
    )
    paused = AutomationSettings(mode="paused")
    assert should_review(paused, is_draft=False, author_type="User", author_login="ada") == (
        False,
        "automation_paused",
    )
    assert is_bot_author("user", "release-bot") is True


# ---------------------------------------------------------------------------
# External target guard
# ---------------------------------------------------------------------------

def test_syntax_guard_rejects_bad_schemes_and_local_hosts():
    for bad in (
        "file:///etc/passwd",
        "ftp://example.com",
        "http://localhost/admin",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://thing.local/",
        "",
    ):
        with pytest.raises(UnsafeTargetError):
            _validate_syntax(bad)


def test_literal_private_addresses_are_rejected():
    async def run(url: str) -> str:
        return await validate_external_url(url)

    with pytest.raises(UnsafeTargetError):
        asyncio.run(run("http://169.254.169.254/latest/meta-data/"))
    with pytest.raises(UnsafeTargetError):
        asyncio.run(run("http://127.0.0.1:8000/health"))
    with pytest.raises(UnsafeTargetError):
        asyncio.run(run("http://[::1]/"))


def test_dns_resolving_to_private_address_is_rejected(monkeypatch):
    def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(UnsafeTargetError):
        asyncio.run(validate_external_url("https://looks-public.example.com/"))


def test_public_literal_is_allowed():
    assert asyncio.run(validate_external_url("https://93.184.216.34/")) == "https://93.184.216.34/"


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def test_sliding_window_limiter_blocks_after_cap():
    from agent.api.rate_limit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(max_events=3, window_seconds=60.0)
    assert limiter.check("repo") == 0.0
    assert limiter.check("repo") == 0.0
    assert limiter.check("repo") == 0.0
    # Fourth attempt in the window is refused and reports a wait time.
    assert limiter.check("repo") > 0.0
    # Budget is per key, so one busy target cannot lock out another.
    assert limiter.check("other-repo") == 0.0


# ---------------------------------------------------------------------------
# Context & Secrets
# ---------------------------------------------------------------------------

def test_context_field_crypto_round_trip(monkeypatch):
    import agent.credentials.store as store_mod
    from agent.credentials.store import CredentialDecryptionError

    monkeypatch.setenv("CREDENTIAL_STORE_KEY", "unit-test-context-key")
    monkeypatch.setattr(store_mod, "_field_cipher", None, raising=False)

    token = store_mod.encrypt_field("s3cret-value")
    assert token.startswith("v2:")
    assert store_mod.decrypt_field(token) == "s3cret-value"
    # A non-v2 payload is refused rather than silently returned as-is.
    with pytest.raises(CredentialDecryptionError):
        store_mod.decrypt_field("plaintext-not-encrypted")


def test_project_context_prompt_excludes_secret_values():
    from agent.projects.context import ProjectContext

    context = ProjectContext(
        variables={"BASE_URL": "https://staging.example.com"},
        secrets={"API_KEY": "super-secret-value"},
        seed=[{"name": "test_account", "value": "qa@example.com", "description": "checkout persona"}],
    )
    prompt = " ".join(context.prompt_lines())
    assert "BASE_URL" in prompt
    assert "qa@example.com" in prompt
    # A credential must never be placed into a prompt.
    assert "super-secret-value" not in prompt
    assert "API_KEY" not in prompt

    summary = context.to_summary()
    assert summary["secret_names"] == ["API_KEY"]
    assert summary["variable_names"] == ["BASE_URL"]
    assert summary["seed_names"] == ["test_account"]


# ---------------------------------------------------------------------------
# Build / boot failure reporting
# ---------------------------------------------------------------------------

def test_raise_on_failure_tags_the_failed_phase():
    import subprocess

    from agent.sandbox.docker_sandbox import SandboxBootError, _raise_on_failure

    failed = subprocess.CompletedProcess(args=["npm", "run", "build"], returncode=1, stdout="", stderr="TS2307")
    with pytest.raises(SandboxBootError) as build_err:
        _raise_on_failure("build", failed, "img:1")
    assert build_err.value.step == "build"
    # The untruncated output travels with the exception so the dashboard can
    # show a real build log, not just the exception message tail.
    assert build_err.value.log == "TS2307"

    with pytest.raises(SandboxBootError) as install_err:
        _raise_on_failure("dependency install", failed, "img:1")
    assert install_err.value.step == "dependency_install"


@pytest.mark.asyncio
async def test_build_failure_is_reported_as_a_critical_case(monkeypatch):
    """A build failure must complete the GitHub check and explain itself.

    Previously the run was marked failed but the code that completes the Check
    Run and posts the PR comment sat after the re-raise, so the check hung
    in-progress and the author saw nothing.
    """
    import agent.db.pr_insights as insights_mod
    from agent.runner import pipeline as pipeline_mod

    captured: dict = {}

    class FakeRunStore:
        def update(self, **kwargs):
            captured["run_update"] = kwargs

    class FakeInsights:
        def record_run_result(self, **kwargs):
            captured["insights"] = kwargs

    class FakeGitHub:
        async def update_check_run(self, **kwargs):
            captured["check_run"] = kwargs
            return {}

        async def post_pr_comment(self, **kwargs):
            captured["comment"] = kwargs
            return {}

    monkeypatch.setattr(pipeline_mod, "default_run_store", FakeRunStore())
    monkeypatch.setattr(insights_mod, "default_pr_insight_store", FakeInsights())

    await pipeline_mod._report_boot_failure(
        step="build",
        safe_error="build failed for img:1: TS2307 cannot find module './x'",
        run_id="run_1",
        owner="acme",
        repo="web",
        branch="feat/x",
        sha="a" * 40,
        base_branch="main",
        pr_number=7,
        check_run_id=99,
        installation_id=1,
        github_client=FakeGitHub(),
        post_comments=True,
        secrets=[],
    )

    assert captured["run_update"]["status"] == "failed"
    result = captured["run_update"]["result"]
    assert result["failure_kind"] == "build"
    assert result["coverage_gate"] == "no_journeys"
    assert result["journeys_executed"] == 0

    case = result["test_cases"][0]
    assert case["status"] == "failed"
    assert case["category"] == "build"
    assert case["severity"] == "critical"
    assert case["verified_this_commit"] is True
    assert result["severity_summary"]["counts"]["critical"] == 1
    assert result["severity_summary"]["all_passed"] is False

    # The GitHub check is completed, not left in progress.
    assert captured["check_run"]["conclusion"] == "failure"
    # The PR explains the failure with the build output.
    assert "TS2307" in captured["comment"]["body"]
    # The PR-centric projection is written too.
    assert captured["insights"]["test_cases"][0]["category"] == "build"


@pytest.mark.asyncio
async def test_boot_failure_persists_full_redacted_build_log(monkeypatch):
    """The dashboard's log view needs the full captured output, redacted.

    ``safe_error`` is only the truncated message; ``log`` carries the complete
    command output, which must survive redaction and land in ``build_log`` and
    the build test case's evidence.
    """
    import agent.db.pr_insights as insights_mod
    from agent.runner import pipeline as pipeline_mod

    captured: dict = {}

    class FakeRunStore:
        def update(self, **kwargs):
            captured["run_update"] = kwargs

    class FakeInsights:
        def record_run_result(self, **kwargs):
            captured["insights"] = kwargs

    class FakeGitHub:
        async def update_check_run(self, **kwargs):
            return {}

        async def post_pr_comment(self, **kwargs):
            return {}

    monkeypatch.setattr(pipeline_mod, "default_run_store", FakeRunStore())
    monkeypatch.setattr(insights_mod, "default_pr_insight_store", FakeInsights())

    full_log = "line-1\nnpm ERR! secret=super-secret-value\n" + ("x" * 12000)

    await pipeline_mod._report_boot_failure(
        step="build",
        safe_error="build failed for img:1: TS2307",
        log=full_log,
        run_id="run_log",
        owner="acme",
        repo="web",
        branch="feat/x",
        sha="c" * 40,
        base_branch="main",
        pr_number=9,
        check_run_id=101,
        installation_id=1,
        github_client=FakeGitHub(),
        post_comments=True,
        secrets=["super-secret-value"],
    )

    result = captured["run_update"]["result"]
    assert "super-secret-value" not in result["build_log"]
    assert "line-1" in result["build_log"]
    # The full log is retained, not just the 4000-char exception message tail.
    assert len(result["build_log"]) > 10000
    assert result["test_cases"][0]["evidence"]["build_output"] == result["build_log"]


@pytest.mark.asyncio
async def test_build_failure_respects_silent_mode(monkeypatch):
    import agent.db.pr_insights as insights_mod
    from agent.runner import pipeline as pipeline_mod

    captured: dict = {}

    class FakeRunStore:
        def update(self, **kwargs):
            captured["run_update"] = kwargs

    class FakeInsights:
        def record_run_result(self, **kwargs):
            captured["insights"] = kwargs

    class FakeGitHub:
        async def update_check_run(self, **kwargs):
            captured["check_run"] = kwargs
            return {}

        async def post_pr_comment(self, **kwargs):
            captured["comment"] = kwargs
            return {}

    monkeypatch.setattr(pipeline_mod, "default_run_store", FakeRunStore())
    monkeypatch.setattr(insights_mod, "default_pr_insight_store", FakeInsights())

    await pipeline_mod._report_boot_failure(
        step="dependency_install",
        safe_error="dependency install failed: EACCES",
        run_id="run_2",
        owner="acme",
        repo="web",
        branch="feat/x",
        sha="b" * 40,
        base_branch="main",
        pr_number=8,
        check_run_id=100,
        installation_id=1,
        github_client=FakeGitHub(),
        post_comments=False,
        secrets=[],
    )

    assert captured["run_update"]["result"]["failure_kind"] == "dependency_install"
    # A silent repository still gets the check result, but no PR comment.
    assert captured["check_run"]["conclusion"] == "failure"
    assert "comment" not in captured


# ---------------------------------------------------------------------------
# Manual PR selection and the saved-test suite
# ---------------------------------------------------------------------------

def _fake_async_client(payload, status: int = 200):
    from unittest.mock import AsyncMock, MagicMock

    response = MagicMock()
    response.status_code = status
    response.json.return_value = payload
    response.raise_for_status = MagicMock()

    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


@pytest.mark.asyncio
async def test_list_pull_requests_normalises_payload():
    from unittest.mock import patch

    from agent.github.app import GitHubAppClient

    payload = [
        {
            "number": 42,
            "title": "Add promo code",
            "user": {"login": "ada", "type": "User"},
            "state": "open",
            "draft": False,
            "head": {"ref": "feat/promo", "sha": "a" * 40},
            "base": {"ref": "main"},
            "html_url": "https://github.com/acme/web/pull/42",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-02T00:00:00Z",
            "changed_files": 3,
            "additions": 10,
            "deletions": 2,
        },
        {
            "number": 43,
            "title": "Bump dep",
            "user": {"login": "dependabot[bot]", "type": "Bot"},
            "state": "open",
            "draft": True,
            "head": {"ref": "deps/bump", "sha": "b" * 40},
            "base": {"ref": "main"},
        },
    ]
    fake = _fake_async_client(payload)

    with patch("agent.github.app.httpx.AsyncClient", return_value=fake):
        pulls = await GitHubAppClient(token="t").list_pull_requests("acme", "web")

    assert len(pulls) == 2
    first = pulls[0]
    assert first["pr_number"] == 42
    assert first["head_sha"] == "a" * 40
    assert first["head_branch"] == "feat/promo"
    assert first["base_branch"] == "main"
    assert first["author_login"] == "ada"
    assert first["changed_files"] == 3
    # A bot-authored draft is still reported, flagged so the caller can decide.
    assert pulls[1]["author_type"] == "Bot"
    assert pulls[1]["is_draft"] is True

    params = fake.get.call_args.kwargs["params"]
    assert params["state"] == "open"
    assert 1 <= params["per_page"] <= 100
    assert params["sort"] == "updated"


def test_pull_requests_endpoint_requires_owner_repo_form():
    from starlette.testclient import TestClient
    from conftest import AUTH_HEADERS
    from agent.main import app

    res = TestClient(app).get("/api/github/pull-requests?repo=web", headers=AUTH_HEADERS)
    assert res.status_code == 400
    assert "owner/repository" in res.json()["detail"]


def test_pull_requests_endpoint_returns_normalised_list(monkeypatch):
    from starlette.testclient import TestClient
    from conftest import AUTH_HEADERS
    from agent.api import github as github_api
    from agent.main import app

    async def fake_list(self, owner, repo, state="open", per_page=50, installation_id=None):
        return [{"pr_number": 7, "title": "x", "author_login": "ada"}]

    monkeypatch.setattr(github_api.GitHubAppClient, "list_pull_requests", fake_list)

    res = TestClient(app).get("/api/github/pull-requests?repo=acme/web", headers=AUTH_HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["pull_requests"][0]["pr_number"] == 7


def test_saved_test_fingerprint_is_stable_and_route_sensitive():
    from agent.projects.saved_tests import saved_test_fingerprint

    a = saved_test_fingerprint("Checkout with promo", "/checkout")
    b = saved_test_fingerprint("checkout   WITH promo", "/checkout")
    assert a == b
    # The same flow name on a different route is a different test.
    assert saved_test_fingerprint("Checkout with promo", "/cart") != a


def test_saved_tests_render_as_planner_instructions():
    from agent.projects.saved_tests import as_instruction_lines

    lines = as_instruction_lines(
        [
            {
                "name": "Checkout with promo",
                "route": "/checkout",
                "intent": "Apply a promo code and complete payment",
                "preconditions": ["qa@example.com"],
            },
            {"name": "Admin can list users", "route": "/admin/users"},
        ]
    )
    assert lines[0] == (
        "- Checkout with promo (route: /checkout): Apply a promo code and complete payment "
        "[setup: qa@example.com]"
    )
    assert lines[1] == "- Admin can list users (route: /admin/users)"


def test_load_saved_tests_degrades_when_database_is_absent(monkeypatch):
    import agent.db.supabase as db
    from agent.projects import saved_tests

    monkeypatch.setattr(db, "get_supabase_client", lambda: None)
    # A missing database must not break a run; the suite is an enhancement.
    assert saved_tests.load_saved_tests("acme/web") == []
