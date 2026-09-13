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
                # Real browser measurement payload (as produced by
                # agent.journeys.web_vitals.collect_web_vitals).
                "web_vitals": {
                    "lcp_ms": 1420.0,
                    "cls": 0.03,
                    "inp_ms": 96.0,
                    "fcp_ms": 810.0,
                    "ttfb_ms": 140.0,
                    "tti_ms": 1650.0,
                    "measured": True,
                    "measured_metrics": ["fcp_ms", "lcp_ms", "cls", "ttfb_ms", "inp_ms", "tti_ms"],
                    "source": "browser_performance_api",
                },
                "action_timings_ms": [180.0, 240.0],
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
        llm_usage={
            "prompt_tokens": 2400,
            "completion_tokens": 620,
            "total_tokens": 3020,
            "measured": True,
            "model_names": ["claude-sonnet-4.6"],
        },
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

    # 2. Core Web Vitals (measured values flow through; statuses derived)
    wv = data["web_vitals"]
    assert wv["measured"] is True
    assert wv["source"] == "aggregated_browser_performance_api"
    assert wv["lcp_ms"] > 0
    assert wv["cls"] <= 0.1
    assert wv["inp_ms"] <= 200
    assert wv["lcp_status"] in ("good", "needs_improvement", "poor")
    assert set(wv["measured_metrics"]) == {"lcp_ms", "cls", "inp_ms", "fcp_ms", "ttfb_ms", "tti_ms"}

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
    # Locator healing is reported ONLY from real recorded healing events. These
    # journeys record none, so the correct result is empty. There used to be a
    # fallback that scraped a <button id=...> out of the DOM and emitted a
    # fabricated "drift healed, 96.2% confidence" entry — absence of a healing
    # event must not be reported as a successful heal.
    assert data["self_healing_locators"] == []
    # Hallucination diagnostics are not evaluated by this pipeline; counts must be
    # None rather than an invented rate over an invented denominator.
    assert data["hallucination_diagnostics"]["status"] == "not_evaluated"
    assert data["hallucination_diagnostics"]["rate_pct"] is None
    assert data["hallucination_diagnostics"]["total_evaluations"] is None

    # 5. Agent Operational Costs (real Strands usage passed in by the caller)
    cost = data["cost_metrics"]
    assert cost["total_tokens"] == 3020
    assert cost["prompt_tokens"] == 2400
    assert cost["completion_tokens"] == 620
    assert cost["inference_cost_usd"] > 0.0
    assert cost["model_name"] == "claude-sonnet-4.6"
    assert cost["measured"] is True
    assert cost["cost_saved_usd_estimate"] is None  # not measurable, never invented
    assert cost["avg_action_latency_ms"] == 210.0
    assert cost["total_actions_metered"] == 2

    # 6. Session timeline: measured per-journey facts only.
    #    The old `synchronized_replay_steps` key invented a timestamp offset
    #    (index * 1200), a fake DOM preview and a hardcoded-200 waterfall. Each
    #    route is recorded as its own clip/trace, so no cross-route sync exists.
    assert "synchronized_replay_steps" not in data
    assert len(data["session_timeline"]) >= 1
    step1 = data["session_timeline"][0]
    assert step1["step_index"] == 1
    assert step1["route"] == "/checkout"
    assert isinstance(step1["duration_ms"], float) and step1["duration_ms"] > 0
    # No invented synchronization or selector fields survive.
    assert "timestamp_offset_ms" not in step1
    assert "target_selector" not in step1
    assert "dom_snapshot_preview" not in step1
    assert "network_waterfall" not in step1

    # 7. Edge Cases & Fuzzing Signals
    assert len(data["fuzzing_robustness"]) >= 3
    assert any(f["payload_type"] == "sqli_injection" for f in data["fuzzing_robustness"])
    assert any(f["payload_type"] == "unicode_emojis" for f in data["fuzzing_robustness"])

    # 8. Flakiness: one execution of a path cannot establish jitter or rerun
    #    consistency, so it is honestly reported as unmeasured (never invented).
    flk = data["flakiness_score"]
    assert flk["flakiness_score"] is None
    assert flk["rating"] == "Unknown"
    assert flk["rerun_pass_consistency_pct"] is None
    assert flk["measured"] is False

    # 9. Multi-Environment & Cross-Context Matrix
    # Viewport and localization matrices are intentionally NOT reported: every
    # journey runs at one default viewport and in the app's own default locale, so
    # claiming Desktop/Tablet/Mobile "Passed" and four locales "Valid" asserted
    # coverage that never happened. Empty = not tested, and the dashboard renders
    # no section. The throttling projections remain, derived from measured LCP.
    assert data["viewport_matrix"] == []
    assert data["localization_matrix"] == []
    assert len(data["network_throttling_impact"]) == 4

    # 10. Business Funnels, Dark Patterns & Platform ROI
    # One funnel per journey actually executed.
    assert len(data["funnel_completion"]) >= 1
    assert data["click_distance_to_value"]["total_steps"] >= 1
    # Not derivable from anything this pipeline observes -> reported as unmeasured
    # rather than as the constants 78.4 / 14.2 that used to be emitted here.
    assert data["test_maintenance_reduction_pct"] is None
    assert data["regression_mttd_seconds"] is None
