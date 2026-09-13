"""Focused tests for the "measured, or explicitly None" metric contract.

Covers the two halves of the requirement:
  (a) genuinely measured values flow end-to-end through the evaluator, and
  (b) values that could not be measured stay ``None`` and are never invented.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from agent.analyzer.quality_dimensions import (
    CostMetrics,
    FlakinessDiagnostic,
    QualityDimensionsEvaluator,
    _compute_run_flakiness,
)
from agent.api.runs import RunRecord
from agent.journeys.web_vitals import (
    WEB_VITALS_INIT_SCRIPT,
    collect_web_vitals,
    vitals_from_raw,
)
from agent.models.usage import (
    UsageAccumulator,
    estimate_cost_usd,
    usage_scope,
)


# ---------------------------------------------------------------------------
# Problem 1: browser Web Vitals
# ---------------------------------------------------------------------------


def test_vitals_from_raw_keeps_unobserved_metrics_none():
    """Metrics the browser never emitted must be None, not a plausible number."""
    raw = {
        "fcp_ms": 812.5,
        "lcp_ms": None,
        "cls": 0.0,
        "cls_observed": False,  # observer never installed -> CLS unmeasured
        "inp_ms": None,  # no interaction happened -> INP unmeasurable
        "ttfb_ms": 120.0,
        "long_tasks": [],
        "now_ms": 3000.0,
    }
    vitals = vitals_from_raw(raw)

    assert vitals["fcp_ms"] == 812.5
    assert vitals["ttfb_ms"] == 120.0
    assert vitals["lcp_ms"] is None
    assert vitals["inp_ms"] is None
    assert vitals["cls"] is None
    assert vitals["measured"] is True
    assert "inp_ms" not in vitals["measured_metrics"]
    assert "cls" not in vitals["measured_metrics"]


def test_vitals_from_raw_measures_observed_metrics_and_approximates_tti():
    raw = {
        "fcp_ms": 500.0,
        "lcp_ms": 1600.0,
        "cls": 0.07,
        "cls_observed": True,
        "inp_ms": 180.0,
        "ttfb_ms": 95.0,
        "long_tasks": [{"start": 1000.0, "duration": 200.0}],
        "now_ms": 2000.0,
    }
    vitals = vitals_from_raw(raw)

    assert vitals["lcp_ms"] == 1600.0
    assert vitals["cls"] == 0.07
    assert vitals["inp_ms"] == 180.0
    assert vitals["ttfb_ms"] == 95.0
    # Long-task quiet-window approximation: last long task ended at 1200ms.
    assert vitals["tti_ms"] == 1200.0
    assert vitals["tti_source"] == "long_task_quiet_window_approx"
    assert vitals["measured_metrics"] == ["fcp_ms", "lcp_ms", "cls", "ttfb_ms", "inp_ms", "tti_ms"]


def test_vitals_from_raw_tti_withheld_until_quiet_window_elapses():
    """If the page was still busy at read time, TTI is not claimed."""
    raw = {
        "fcp_ms": 400.0,
        "cls": 0.0,
        "cls_observed": True,
        "long_tasks": [{"start": 900.0, "duration": 300.0}],
        "now_ms": 1300.0,  # only 100ms of quiet after the task ended at 1200ms
    }
    assert vitals_from_raw(raw)["tti_ms"] is None


def test_vitals_from_raw_without_fcp_stays_fully_unmeasured():
    vitals = vitals_from_raw(None)
    assert vitals["measured"] is False
    assert vitals["source"] == "unmeasured"
    assert all(vitals[name] is None for name in ("lcp_ms", "cls", "inp_ms", "fcp_ms", "ttfb_ms", "tti_ms"))


def test_collect_web_vitals_reads_browser_global():
    page = MagicMock()
    page.evaluate.return_value = {
        "fcp_ms": 700.0,
        "lcp_ms": 1500.0,
        "cls": 0.02,
        "cls_observed": True,
        "inp_ms": None,
        "ttfb_ms": 110.0,
        "long_tasks": [],
        "now_ms": 4000.0,
    }
    vitals = collect_web_vitals(page)
    assert vitals["measured"] is True
    assert vitals["lcp_ms"] == 1500.0
    assert vitals["inp_ms"] is None
    assert WEB_VITALS_INIT_SCRIPT  # collector script is exported for init-script install


def test_evaluate_path_without_measurement_never_invents_vitals():
    """No web_vitals payload -> every metric None; duration must not leak in."""
    evaluator = QualityDimensionsEvaluator()
    metrics = evaluator.evaluate_path(
        path="/checkout",
        dom_snapshot="<html><body><h1>Checkout</h1></body></html>",
        duration_ms=4321.0,
    )
    assert metrics.web_vitals.lcp_ms is None
    assert metrics.web_vitals.cls is None
    assert metrics.web_vitals.inp_ms is None
    assert metrics.web_vitals.fcp_ms is None
    assert metrics.web_vitals.ttfb_ms is None
    assert metrics.web_vitals.tti_ms is None
    assert metrics.web_vitals.measured is False
    rendered = metrics.web_vitals.to_dict()
    assert rendered["lcp_status"] == "unknown"
    assert rendered["cls_status"] == "unknown"
    assert rendered["inp_status"] == "unknown"


def test_measured_vitals_flow_through_evaluate_run():
    evaluator = QualityDimensionsEvaluator()
    record = RunRecord(run_id="r_vitals", branch="b", sha="s", scope="changed")
    measurement = {
        "lcp_ms": 2100.0,
        "cls": 0.05,
        "inp_ms": None,
        "fcp_ms": 900.0,
        "ttfb_ms": 130.0,
        "tti_ms": 2400.0,
        "measured": True,
        "measured_metrics": ["fcp_ms", "lcp_ms", "cls", "ttfb_ms", "tti_ms"],
        "source": "browser_performance_api",
    }
    report = evaluator.evaluate_run(
        run_record=record,
        journeys=[
            {
                "route": "/checkout",
                "dom_snapshot": "<html><body><h1>Checkout</h1></body></html>",
                "duration_ms": 2000.0,
                "web_vitals": measurement,
            }
        ],
    )
    data = report.to_dict()
    per_path = data["per_path_analysis"]["/checkout"]["web_vitals"]
    assert per_path["lcp_ms"] == 2100.0
    assert per_path["cls"] == 0.05
    assert per_path["inp_ms"] is None
    assert per_path["inp_status"] == "unknown"

    run_vitals = data["web_vitals"]
    assert run_vitals["measured"] is True
    assert run_vitals["lcp_ms"] == 2100.0
    assert run_vitals["inp_ms"] is None
    # Aggregation only averages metrics that were actually measured.
    assert sorted(run_vitals["measured_metrics"]) == ["cls", "fcp_ms", "lcp_ms", "ttfb_ms", "tti_ms"]
    # TTI is always an approximation, and the report says so.
    assert run_vitals["tti_source"] == "long_task_quiet_window_approx"


def test_unmeasured_vitals_stay_none_at_run_level():
    evaluator = QualityDimensionsEvaluator()
    record = RunRecord(run_id="r_vitals_none", branch="b", sha="s", scope="changed")
    report = evaluator.evaluate_run(
        run_record=record,
        journeys=[{"route": "/checkout", "dom_snapshot": "<h1>x</h1>", "duration_ms": 5000.0}],
    )
    run_vitals = report.to_dict()["web_vitals"]
    for name in ("lcp_ms", "cls", "inp_ms", "fcp_ms", "ttfb_ms", "tti_ms"):
        assert run_vitals[name] is None
    assert run_vitals["measured"] is False
    assert run_vitals["source"] == "unmeasured"
    assert run_vitals["tti_source"] is None
    # Throttled-load projections depend on a measured LCP, so they are None too.
    assert all(item["load_time_ms"] is None for item in report.to_dict()["network_throttling_impact"][:3])


# ---------------------------------------------------------------------------
# Problem 2: LLM cost/token metrics
# ---------------------------------------------------------------------------


def test_cost_metrics_unmeasured_are_none_not_plausible_constants():
    evaluator = QualityDimensionsEvaluator()
    record = RunRecord(run_id="r_cost_none", branch="b", sha="s", scope="changed")
    report = evaluator.evaluate_run(
        run_record=record,
        journeys=[{"route": "/x", "dom_snapshot": "<h1>x</h1>" * 40, "duration_ms": 1000.0}],
    )
    cost = report.to_dict()["cost_metrics"]
    assert cost["prompt_tokens"] is None
    assert cost["completion_tokens"] is None
    assert cost["total_tokens"] is None
    assert cost["inference_cost_usd"] is None
    assert cost["cost_saved_usd_estimate"] is None
    assert cost["measured"] is False
    # model_name is the actually-configured model, never the old hardcoded string.
    assert cost["model_name"] != "claude-3-5-haiku"
    assert cost["model_name"]


def test_cost_metrics_from_measured_usage_and_known_pricing():
    evaluator = QualityDimensionsEvaluator()
    record = RunRecord(run_id="r_cost", branch="b", sha="s", scope="changed")
    report = evaluator.evaluate_run(
        run_record=record,
        journeys=[{"route": "/x", "dom_snapshot": "<h1>x</h1>"}],
        llm_usage={
            "prompt_tokens": 1_000_000,
            "completion_tokens": 1_000_000,
            "total_tokens": 2_000_000,
            "measured": True,
            "model_names": ["claude-sonnet-4.6"],
        },
    )
    cost = report.to_dict()["cost_metrics"]
    assert cost["prompt_tokens"] == 1_000_000
    assert cost["total_tokens"] == 2_000_000
    assert cost["model_name"] == "claude-sonnet-4.6"
    # sonnet: $3 input + $15 output per MTok -> $18 for 1M/1M.
    assert cost["inference_cost_usd"] == 18.0
    assert cost["measured"] is True


def test_estimate_cost_usd_returns_none_for_unknown_model_or_missing_tokens():
    assert estimate_cost_usd("totally-unknown-model", 1000, 1000) is None
    assert estimate_cost_usd(None, 1000, 1000) is None
    assert estimate_cost_usd("claude-sonnet-4.6", None, 1000) is None
    assert estimate_cost_usd("claude-sonnet-4.6", 1000, 1000) is not None


def test_action_timings_are_averaged_from_real_samples():
    evaluator = QualityDimensionsEvaluator()
    metrics = evaluator.evaluate_path(
        path="/x",
        dom_snapshot="<h1>x</h1>",
        duration_ms=9999.0,
        action_timings_ms=[100.0, 200.0, 300.0],
    )
    assert metrics.cost.avg_action_latency_ms == 200.0
    assert metrics.cost.total_actions_metered == 3
    assert metrics.cost.measured is True
    # No action timings -> nothing metered, but no invented latency either.
    empty = evaluator.evaluate_path(path="/y", dom_snapshot="<h1>y</h1>", duration_ms=9999.0)
    assert empty.cost.avg_action_latency_ms is None
    assert empty.cost.total_actions_metered == 0


def test_usage_accumulator_sums_real_strands_summaries():
    class _FakeMetrics:
        def get_summary(self):
            return {
                "total_cycles": 3,
                "accumulated_usage": {
                    "inputTokens": 1500,
                    "outputTokens": 400,
                    "totalTokens": 1900,
                    "cacheReadInputTokens": 50,
                    "cacheWriteInputTokens": 10,
                },
            }

    class _FakeModel:
        def get_config(self):
            return {"model_id": "claude-haiku-4.5"}

    class _FakeAgent:
        def __init__(self):
            self.model = _FakeModel()
            self.event_loop_metrics = _FakeMetrics()

    accumulator = UsageAccumulator()
    accumulator.record_agent(_FakeAgent())
    accumulator.record_agent(_FakeAgent())
    snapshot = accumulator.snapshot()

    assert snapshot.measured is True
    assert snapshot.prompt_tokens == 3000
    assert snapshot.completion_tokens == 800
    assert snapshot.total_tokens == 3800
    assert snapshot.cache_read_tokens == 100
    assert snapshot.invocation_count == 6
    assert snapshot.model_names == ["claude-haiku-4.5"]


def test_usage_accumulator_without_agents_is_unmeasured():
    snapshot = UsageAccumulator().snapshot()
    assert snapshot.measured is False
    assert snapshot.prompt_tokens is None
    assert snapshot.total_tokens is None


def test_usage_scope_registers_agents_created_by_factory():
    from agent.models.factory import ModelRole, create_strands_agent

    with usage_scope() as accumulator:
        create_strands_agent(ModelRole.CODE_REASONING, api_key="dummy")

    assert accumulator.agent_count == 1
    snapshot = accumulator.snapshot()
    assert snapshot.measured is True
    assert snapshot.model_names


# ---------------------------------------------------------------------------
# Problem 3: flakiness
# ---------------------------------------------------------------------------


def test_flakiness_single_execution_is_unmeasured():
    diagnostic = _compute_run_flakiness(
        [{"route": "/x", "passed": True, "duration_ms": 1200.0}]
    )
    assert isinstance(diagnostic, FlakinessDiagnostic)
    assert diagnostic.flakiness_score is None
    assert diagnostic.rating == "Unknown"
    assert diagnostic.timing_jitter_ms is None
    assert diagnostic.rerun_pass_consistency_pct is None
    assert diagnostic.hydration_delay_ms is None
    assert diagnostic.measured is False

    empty = FlakinessDiagnostic()
    assert empty.to_dict()["flakiness_score"] is None
    assert empty.to_dict()["rating"] == "Unknown"


def test_flakiness_derived_from_real_repeated_runs():
    diagnostic = _compute_run_flakiness(
        [
            {"route": "/x", "passed": True, "duration_ms": 1000.0, "network_requests": []},
            {"route": "/x", "passed": True, "duration_ms": 1300.0, "network_requests": []},
            {
                "route": "/x",
                "passed": False,
                "duration_ms": 1600.0,
                "network_requests": [{"url": "u", "status": 500}],
            },
            {"route": "/x", "passed": False, "duration_ms": 1900.0, "network_requests": [{"url": "u", "status": 500}]},
        ]
    )
    assert diagnostic.measured is True
    assert diagnostic.sample_count == 4
    assert diagnostic.rerun_pass_consistency_pct == 50.0
    assert diagnostic.timing_jitter_ms == 900.0
    assert diagnostic.network_status_variance == 0.25
    assert diagnostic.flakiness_score == 5.0
    assert diagnostic.rating == "Flaky Hydration"
    # Hydration delay has no reliable per-run signal, so it stays None.
    assert diagnostic.hydration_delay_ms is None


def test_cost_metrics_defaults_are_all_none():
    cost = CostMetrics()
    rendered = cost.to_dict()
    assert rendered["prompt_tokens"] is None
    assert rendered["inference_cost_usd"] is None
    assert rendered["cost_saved_usd_estimate"] is None
    assert rendered["model_name"] is None
    assert rendered["measured"] is False
