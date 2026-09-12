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


def test_full_30_quality_dimensions_and_observability_suite():
    evaluator = QualityDimensionsEvaluator()

    record = RunRecord(
        run_id="run_complete_30_audit",
        branch="feature/modern-checkout",
        sha="7f8b9c0d1e2f",
        scope="changed",
        status="completed",
        trace_url="https://storage.supabase.co/traces/run_complete_30_audit.zip",
        video_url="https://storage.supabase.co/video/run_complete_30_audit.mp4",
    )

    report = evaluator.evaluate_run(
        run_record=record,
        journeys=[
            {
                "route": "/checkout",
                "dom_snapshot": (
                    "<html lang='en' dir='rtl'><head><title>Secure Checkout - Pay Now</title>"
                    "<meta name='description' content='Fast and secure checkout with Apple Pay and credit card.'>"
                    "<script type='application/ld+json'>{}</script></head>"
                    "<body><h1>Secure Checkout</h1>"
                    "<button id='apple-pay' aria-label='Apple Pay'>Apple Pay</button>"
                    "<input id='card-num' aria-label='Card Number' placeholder='4111 2222' />"
                    "<div class='price'>$99.00 USD</div></body></html>"
                ),
                "duration_ms": 1150.0,
                "network_requests": [
                    {"url": "https://api.example.com/checkout", "status": 200, "size": 1200},
                    {"url": "https://api.example.com/telemetry", "status": 200, "size": 400},
                ],
                "console_errors": [],
                "response_headers": {
                    "content-security-policy": "default-src 'self'",
                    "strict-transport-security": "max-age=31536000",
                    "x-frame-options": "DENY",
                    "x-content-type-options": "nosniff",
                    "referrer-policy": "strict-origin",
                },
            }
        ],
        repo_dir="/fake/repo",
        git_diff="+ import { test } from 'vitest';\n+ test('checkout renders', () => {});\n+ const fee = 0;",
    )

    data = report.to_dict()

    # 1. 8 Core Non-Functional Dimensions
    assert data["dimensions"]["performance"] >= 80
    assert data["dimensions"]["usability"] >= 85
    assert data["dimensions"]["i18n"] >= 85
    assert data["dimensions"]["security"] >= 85
    assert data["dimensions"]["reliability"] >= 85
    assert data["dimensions"]["seo"] >= 80
    assert data["dimensions"]["maintainability"] >= 85  # Real test detection bonus
    assert data["dimensions"]["observability"] >= 85  # Real trace/video/telemetry aggregation

    # 2. Core Web Vitals
    wv = data["web_vitals"]
    assert wv["lcp_ms"] > 0
    assert wv["cls"] <= 0.1
    assert wv["inp_ms"] <= 200
    assert wv["lcp_status"] in ("good", "needs_improvement", "poor")

    # 3. Path & Trajectory Analytics (State Graph, Efficiency, Loops, Friction, Dead Ends)
    sg = data["state_graph"]
    assert len(sg["nodes"]) >= 2
    assert sg["coverage_stats"]["coverage_pct"] > 0
    assert any(n["status"] == "visited" for n in sg["nodes"])
    assert any(n["status"] == "unexplored" for n in sg["nodes"])

    traj = data["trajectory_analytics"]
    assert traj["efficiency_score"] >= 80.0
    assert traj["actual_steps"] >= traj["optimal_steps"]

    # 4. Autonomous Agent Intelligence & Diagnostics
    assert len(data["intent_vs_outcome"]) >= 1
    assert data["intent_vs_outcome"][0]["alignment_status"] == "aligned"
    assert len(data["self_healing_locators"]) >= 1
    assert data["self_healing_locators"][0]["confidence_score"] > 80.0

    # 5. Agent Operational Costs (Real Token & USD Tracking)
    cost = data["cost_metrics"]
    assert cost["total_tokens"] > 0
    assert cost["prompt_tokens"] > 0
    assert cost["completion_tokens"] > 0
    assert cost["inference_cost_usd"] > 0.0

    # 6. Synchronized Replay & Telemetry
    assert len(data["synchronized_replay_steps"]) >= 1
    step1 = data["synchronized_replay_steps"][0]
    assert step1["step_index"] == 1
    assert step1["route"] == "/checkout"
    assert len(step1["network_waterfall"]) >= 1

    # 7. Edge Cases & Fuzzing Signals
    assert len(data["fuzzing_robustness"]) >= 3
    assert any(f["payload_type"] == "sqli_injection" for f in data["fuzzing_robustness"])
    assert any(f["payload_type"] == "unicode_emojis" for f in data["fuzzing_robustness"])

    # 8. Flakiness Score (Real statistical diagnostic)
    flk = data["flakiness_score"]
    assert flk["flakiness_score"] >= 0.0
    assert flk["rating"] in ("Deterministic", "Mild Jitter", "Flaky Hydration", "High Non-Determinism")

    # 9. Multi-Environment & Cross-Context Matrix
    assert len(data["viewport_matrix"]) == 3  # Desktop, Tablet, Mobile
    assert len(data["localization_matrix"]) == 4  # en-US, de-DE, ar-SA, ja-JP
    assert len(data["network_throttling_impact"]) == 4  # Broadband, Fast 3G, Slow 3G, Offline

    # 10. Business Funnels, Dark Patterns & Platform ROI
    assert len(data["funnel_completion"]) >= 2
    assert data["click_distance_to_value"]["total_steps"] >= 1
    assert data["test_maintenance_reduction_pct"] > 50.0
    assert data["regression_mttd_seconds"] > 0.0
