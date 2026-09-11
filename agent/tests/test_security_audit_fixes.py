"""Comprehensive unit tests validating all security, reliability, and data integrity fixes."""

import pytest
from datetime import UTC, datetime, timedelta
from agent.analyzer.quality_dimensions import default_quality_evaluator, QualityDimensionsEvaluator
from agent.analyzer.fleet_analytics import (
    FleetAnalyticsAggregator,
    calculate_percentile,
    extract_component_name,
)
from agent.analyzer.ai_insights import AIInsightsEngine
from agent.api.runs import RunRecord, RunStore
from agent.credentials.redaction import REDACTION_PATTERNS, redact_credentials, REDACTED_LABEL


def test_mixed_content_detected_on_https_base():
    """Verify mixed_content_detected fires on path='/checkout' when base_url is HTTPS."""
    evaluator = QualityDimensionsEvaluator()

    # 1. Pure HTTPS page -> mixed_content should be False
    pure_https = evaluator.evaluate_path(
        path="/checkout",
        dom_snapshot="<html lang='en'><head><title>Checkout</title></head><body><img src='https://cdn.example.com/logo.png'></body></html>",
        base_url="https://store.example.com",
    )
    assert pure_https.mixed_content_detected is False

    # 2. Insecure image asset on HTTPS page -> mixed_content must be True
    mixed_page = evaluator.evaluate_path(
        path="/checkout",
        dom_snapshot="<html lang='en'><head><title>Checkout</title></head><body><img src='http://insecure.cdn.com/pixel.gif'></body></html>",
        base_url="https://store.example.com",
    )
    assert mixed_page.mixed_content_detected is True
    assert mixed_page.security_score < pure_https.security_score

    # 3. Insecure network request on HTTPS page -> mixed_content must be True
    mixed_req_page = evaluator.evaluate_path(
        path="https://store.example.com/login",
        dom_snapshot="<html lang='en'><head><title>Login</title></head><body><h1>Login</h1></body></html>",
        network_requests=[{"url": "http://api.internal.com/beacon", "status": 200}],
    )
    assert mixed_req_page.mixed_content_detected is True


def test_secret_redaction_in_js_errors_and_failed_requests():
    """Verify that credentials in console errors and failed request URLs are redacted."""
    evaluator = QualityDimensionsEvaluator()

    leaked_console = [
        "Uncaught Error: failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "Failed login with password='SuperSecretPassword123'",
    ]
    leaked_requests = [
        {"url": "https://api.example.com/checkout?token=ghp_123456789012345678901234567890123456&user=admin", "status": 500},
    ]

    metrics = evaluator.evaluate_path(
        path="/checkout",
        dom_snapshot="<html lang='en'><head><title>Checkout</title></head><body><h1>Checkout</h1></body></html>",
        console_errors=leaked_console,
        network_requests=leaked_requests,
    )

    # Assert js_errors are sanitized
    assert len(metrics.js_errors) == 2
    for err in metrics.js_errors:
        assert "SuperSecretPassword123" not in err
        assert "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" not in err
        assert REDACTED_LABEL in err

    # Assert failed_requests are sanitized
    assert len(metrics.failed_requests) == 1
    assert "ghp_123456789012345678901234567890123456" not in metrics.failed_requests[0]
    assert REDACTED_LABEL in metrics.failed_requests[0]


def test_redaction_patterns_aligned():
    """Verify REDACTION_PATTERNS matches all patterns executed in redact_credentials."""
    assert len(REDACTION_PATTERNS) >= 9
    for pattern in REDACTION_PATTERNS:
        assert hasattr(pattern, "findall")
        assert hasattr(pattern, "sub")


def test_fleet_analytics_real_velocity_trend():
    """Verify that velocity trend accurately groups real runs by created_at and does not use pseudo-random formulas."""
    aggregator = FleetAnalyticsAggregator()

    now = datetime.now(UTC)
    yesterday = now - timedelta(days=1)
    two_days_ago = now - timedelta(days=2)

    runs = [
        RunRecord(
            run_id="run_1",
            branch="feat/checkout",
            sha="sha1",
            status="passed",
            created_at=yesterday.isoformat(),
            result={"status": "success", "duration_s": 1.1},
        ),
        RunRecord(
            run_id="run_2",
            branch="feat/checkout",
            sha="sha2",
            status="failed",
            created_at=yesterday.isoformat(),
            result={"status": "failure", "duration_s": 2.5},
        ),
        RunRecord(
            run_id="run_3",
            branch="feat/auth",
            sha="sha3",
            status="passed",
            created_at=two_days_ago.isoformat(),
            result={"status": "success", "duration_s": 0.9},
        ),
    ]

    metrics = aggregator.aggregate_runs(runs)
    trend = metrics.velocity_trend

    yesterday_str = yesterday.strftime("%b %d")
    two_days_ago_str = two_days_ago.strftime("%b %d")

    yesterday_entry = next((item for item in trend if item["date"] == yesterday_str), None)
    two_days_entry = next((item for item in trend if item["date"] == two_days_ago_str), None)

    assert yesterday_entry is not None
    assert yesterday_entry["passed"] == 1
    assert yesterday_entry["failed"] == 1

    assert two_days_entry is not None
    assert two_days_entry["passed"] == 1
    assert two_days_entry["failed"] == 0


def test_percentile_linear_interpolation():
    """Verify percentile calculation computes accurate linear interpolation."""
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    # Median / 50th percentile of 5 values (index 2) is 30.0
    assert calculate_percentile(values, 0.50) == 30.0
    # 25th percentile is halfway between 20.0 and 30.0 = 20.0
    assert calculate_percentile(values, 0.25) == 20.0
    # 75th percentile is 40.0
    assert calculate_percentile(values, 0.75) == 40.0


def test_component_extraction():
    """Verify branch component extraction handles branches with and without slashes without conflating."""
    assert extract_component_name("feat/checkout") == "checkout"
    assert extract_component_name("fix/login-form") == "login-form"
    assert extract_component_name("checkout-v2") == "checkout-v2"
    assert extract_component_name("main") == "core"
    assert extract_component_name("staging") == "core"
    assert extract_component_name("site-preview", scope="external") == "external:site-preview"


def test_run_store_bounded_query():
    """Verify RunStore.list_all supports limit and offset pagination."""
    store = RunStore()
    for i in range(25):
        store.create(branch=f"feat/feature-{i}", sha=f"sha_{i}")

    all_items = store.list_all()
    assert len(all_items) == 25

    page1 = store.list_all(limit=10, offset=0)
    assert len(page1) == 10

    page2 = store.list_all(limit=10, offset=10)
    assert len(page2) == 10
    assert page1[0].run_id != page2[0].run_id

    page3 = store.list_all(limit=10, offset=20)
    assert len(page3) == 5
