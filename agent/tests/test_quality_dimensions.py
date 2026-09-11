"""Unit tests for QualityDimensionsEvaluator and PerPathAnalyzer."""

import pytest
from agent.analyzer.quality_dimensions import (
    QualityDimensionsEvaluator,
    default_quality_evaluator,
)
from agent.api.runs import RunRecord


def test_evaluate_path_basic_and_scores():
    evaluator = QualityDimensionsEvaluator()
    dom = """
    <html lang="en">
    <head>
        <title>Checkout - Complete your purchase</title>
        <meta name="description" content="Secure and fast one-tap checkout for your cart items.">
    </head>
    <body>
        <h1>Checkout</h1>
        <button id="pay" aria-label="Apple Pay">Pay Now</button>
        <img src="/logo.png" alt="Company Logo" />
        <div class="price">$49.99 USD</div>
    </body>
    </html>
    """
    reqs = [
        {"url": "https://example.com/api/cart", "status": 200, "size": 1500},
        {"url": "https://example.com/logo.png", "status": 200, "size": 25000},
    ]
    headers = {
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=31536000",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin",
    }

    metrics = evaluator.evaluate_path(
        path="/checkout",
        dom_snapshot=dom,
        network_requests=reqs,
        console_errors=[],
        duration_ms=850.0,
        response_headers=headers,
        is_external=False,
    )

    assert metrics.path == "/checkout"
    assert metrics.performance_score >= 85
    assert metrics.usability_score >= 80
    assert metrics.security_score >= 80
    assert metrics.seo_score >= 80
    assert metrics.has_title is True
    assert metrics.h1_count == 1
    assert metrics.passed is True
    assert metrics.missing_image_alts == 0
    assert len(metrics.missing_headers) == 0


def test_evaluate_path_flags_missing_accessibility_and_security():
    evaluator = QualityDimensionsEvaluator()
    bad_dom = """
    <html>
    <head></head>
    <body>
        <button id="btn1">No Label</button>
        <button id="btn2">No Label Either</button>
        <input type="text" />
        <img src="/banner.jpg" />
    </body>
    </html>
    """
    metrics = evaluator.evaluate_path(
        path="/flawed",
        dom_snapshot=bad_dom,
        network_requests=[{"url": "https://example.com/api/bad", "status": 500, "size": 500}],
        console_errors=["Uncaught TypeError: Cannot read property of undefined"],
        duration_ms=6200.0,
        response_headers={},
        is_external=True,
    )

    assert metrics.usability_score <= 75
    assert metrics.security_score < 70
    assert metrics.reliability_score < 70
    assert metrics.passed is False
    assert len(metrics.missing_headers) >= 4
    assert len(metrics.js_errors) == 1
    assert len(metrics.failed_requests) == 1


def test_evaluate_run_white_box_vs_black_box():
    evaluator = QualityDimensionsEvaluator()

    # White-box GitHub PR run
    pr_record = RunRecord(
        run_id="run_pr_test",
        branch="feat/quick-checkout",
        sha="abcdef12",
        scope="changed",
    )
    pr_report = evaluator.evaluate_run(
        run_record=pr_record,
        journeys=[{"route": "/checkout", "dom_snapshot": "<h1>Checkout</h1><button aria-label='Pay'>Pay</button>", "duration_ms": 1100}],
        repo_dir="/fake/repo",
        git_diff="+ const x = 1;\n- const x = 0;",
    )
    assert pr_report.mode == "github_pr"
    assert pr_report.remediation_type == "patch"
    assert "/checkout" in pr_report.per_path_analysis
    assert pr_report.composite_health_index > 0

    # Black-box External site run
    ext_record = RunRecord(
        run_id="run_ext_test",
        branch="external-site",
        sha="https://my-live-app.com",
        scope="external",
    )
    ext_report = evaluator.evaluate_run(
        run_record=ext_record,
        journeys=[{"route": "/", "dom_snapshot": "<title>Home</title><h1>Welcome</h1>", "duration_ms": 1400}],
        repo_dir=None,
    )
    assert ext_report.mode == "external_site"
    assert ext_report.remediation_type == "advisory"
    assert "/" in ext_report.per_path_analysis
    assert len(ext_report.remediations) > 0
