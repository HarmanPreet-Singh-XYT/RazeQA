"""Unit tests for FleetAnalyticsAggregator and multi-run percentile calculations."""

import pytest
from agent.analyzer.fleet_analytics import FleetAnalyticsAggregator
from agent.api.runs import RunRecord


def test_fleet_aggregation_empty():
    aggregator = FleetAnalyticsAggregator()
    metrics = aggregator.aggregate_runs([])
    assert metrics.total_runs == 0
    assert metrics.composite_fleet_health > 0
    assert "performance" in metrics.dimensions


def test_fleet_aggregation_with_runs():
    aggregator = FleetAnalyticsAggregator()
    runs = [
        RunRecord(
            run_id="run_1",
            branch="feat/login",
            sha="sha1",
            scope="changed",
            status="passed",
            result={"status": "success", "duration_s": 1.1},
        ),
        RunRecord(
            run_id="run_2",
            branch="feat/checkout",
            sha="sha2",
            scope="changed",
            status="failed",
            result={"status": "failure", "duration_s": 2.8},
        ),
        RunRecord(
            run_id="run_3",
            branch="external-site",
            sha="https://example.com",
            scope="external",
            status="passed",
            result={"status": "success", "duration_s": 1.5},
        ),
    ]

    metrics = aggregator.aggregate_runs(runs)
    assert metrics.total_runs == 3
    assert metrics.pr_runs_count == 2
    assert metrics.external_runs_count == 1
    assert metrics.pass_rate == pytest.approx(66.7, 0.1)
    assert metrics.p50_latency_ms > 0
    assert metrics.p95_latency_ms >= metrics.p50_latency_ms
    assert len(metrics.velocity_trend) > 0
    assert len(metrics.component_risk_heatmap) > 0
