"""Unit tests for AIInsightsEngine and interactive natural language queries."""

import pytest
from agent.analyzer.ai_insights import AIInsightsEngine
from agent.analyzer.fleet_analytics import FleetAnalyticsAggregator
from agent.api.runs import RunRecord


def test_ai_insights_generation():
    engine = AIInsightsEngine()
    aggregator = FleetAnalyticsAggregator()
    runs = [
        RunRecord(
            run_id="run_1",
            branch="feat/quick-checkout",
            sha="sha1",
            status="failed",
            result={"status": "failure", "duration_s": 3.2},
        )
    ]
    metrics = aggregator.aggregate_runs(runs)
    insights = engine.generate_fleet_insights(metrics, runs)

    assert len(insights) >= 2
    severities = {i.severity for i in insights}
    assert "critical" in severities or "warning" in severities or "optimization" in severities


def test_ai_analyst_interactive_query():
    engine = AIInsightsEngine()
    aggregator = FleetAnalyticsAggregator()
    metrics = aggregator.aggregate_runs([])

    # Test checkout query
    res_checkout = engine.answer_query("Why did checkout fail?", metrics, [])
    assert "checkout" in res_checkout["answer"].lower()
    assert res_checkout["confidence"] > 0.8
    assert len(res_checkout["suggested_actions"]) > 0

    # Test security query
    res_sec = engine.answer_query("What is our security compliance?", metrics, [])
    assert "security" in res_sec["answer"].lower()

    # Test i18n query
    res_i18n = engine.answer_query("How is Arabic RTL support?", metrics, [])
    assert "rtl" in res_i18n["answer"].lower()
