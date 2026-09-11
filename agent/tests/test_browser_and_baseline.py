"""Unit tests for Browser Agent, Baseline Comparison, and Dashboard UI."""

from __future__ import annotations

from starlette.testclient import TestClient

from agent.journeys.browser_agent import PageObservation, ScrollableRegion
from agent.main import app
from agent.runner.baseline import BaselineStore, RegressionCategory
from conftest import AUTH_HEADERS


def test_baseline_comparison_categories() -> None:
    store = BaselineStore()
    repo = "test-repo"

    # Seed baseline on main
    store.set_baseline(repo, "login", passed=True)
    store.set_baseline(repo, "broken-flow", passed=False)

    pr_journeys = [
        {"name": "login", "passed": False, "error": "Auth failed"},  # Regressed!
        {"name": "broken-flow", "passed": False, "error": "Still broken"},  # Pre-existing
        {"name": "new-feature", "passed": True, "error": None},  # Pass
    ]

    res = store.compare(repo, pr_journeys)
    assert res["has_new_regressions"] is True

    cat_map = {item["name"]: item["category"] for item in res["all"]}
    assert cat_map["login"] == RegressionCategory.NEW_REGRESSION.value
    assert cat_map["broken-flow"] == RegressionCategory.PRE_EXISTING_BUG.value
    assert cat_map["new-feature"] == RegressionCategory.STABLE_PASS.value


def test_browser_agent_observation_structures() -> None:
    region = ScrollableRegion(
        selector="#sidebar-scroll",
        tag_name="aside",
        scroll_height=1200,
        client_height=600,
        overflow_y="auto",
    )
    obs = PageObservation(
        url="http://localhost:3000/dashboard",
        title="Dashboard",
        interactive_elements=['button#submit: "Save"'],
        scrollable_regions=[region],
    )
    assert obs.title == "Dashboard"
    assert len(obs.scrollable_regions) == 1
    assert obs.scrollable_regions[0].overflow_y == "auto"
    assert obs.scrollable_regions[0].scroll_height > obs.scrollable_regions[0].client_height


def test_dashboard_ui_endpoint() -> None:
    client = TestClient(app, headers=AUTH_HEADERS)
    res = client.get("/dashboard")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "Autonomous PR Testing Engine" in res.text
    assert "stat-regressions" in res.text
    assert "Copy Remediation Prompt" in res.text
