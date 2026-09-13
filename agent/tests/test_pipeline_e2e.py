"""E2E Pipeline and Background Task Verification."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from agent.api.runs import run_store
from agent.bridge.models import IntentEvent
from agent.main import app
from agent.runner.pipeline import run_pipeline
from conftest import AUTH_HEADERS


@pytest.fixture(autouse=True)
def clean_store():
    run_store.clear()
    yield
    run_store.clear()


def test_trigger_run_dispatches_background_task():
    """Verify POST /runs dispatches background pipeline execution and stores queued status."""
    client = TestClient(app, headers=AUTH_HEADERS)
    payload = {
        "branch": "feature/test-checkout",
        "sha": "abc1234567890abcdef",
        "scope": "changed",
        "test_type": "functional",
    }

    res = client.post("/runs", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["fresh"] is True
    assert data["status"] == "queued"
    assert data["run_id"].startswith("run_")

    # Verify run exists in store
    rec = run_store.get(data["run_id"])
    assert rec is not None
    assert rec.branch == "feature/test-checkout"


@pytest.mark.asyncio
async def test_run_pipeline_executes_exploratory_and_baseline(tmp_path: Path):
    """Verify run_pipeline analyzes diff/intent, runs journeys, and updates run record."""
    branch = "feature/e2e-test"
    sha = "11223344556677889900"
    intents = [
        IntentEvent(
            files=["app/checkout/page.tsx"],
            action="edit",
            prompt_summary="Add checkout promo banner",
            reasoning="Increase conversions on cart checkout page",
            branch=branch,
            sha=sha,
        )
    ]

    # Mock journey runners so tests do not require an active web dev server
    mock_login_res = AsyncMock()
    mock_login_res.passed = True
    mock_login_res.error = None
    mock_login_res.trace_path = Path("artifacts/runs/test/login-trace.zip")
    mock_login_res.video_path = Path("artifacts/runs/test/video/video.webm")

    mock_route_res = {
        "passed": True,
        "name": "exploratory:_checkout",
        "route": "/checkout",
        "trace_path": "artifacts/runs/test/checkout-trace.zip",
        "video_path": "artifacts/runs/test/video/video2.webm",
        "screenshot_path": "artifacts/runs/test/checkout-visual.png",
        # Real measured journey outputs, as run_route_journey would produce.
        "duration_ms": 1400.0,
        "action_timings_ms": [120.0, 280.0],
        "web_vitals": {
            "lcp_ms": 1420.0,
            "cls": 0.04,
            "inp_ms": None,
            "fcp_ms": 700.0,
            "ttfb_ms": 110.0,
            "tti_ms": 1600.0,
            "measured": True,
            "measured_metrics": ["fcp_ms", "lcp_ms", "cls", "ttfb_ms", "tti_ms"],
            "source": "browser_performance_api",
        },
    }

    with (
        patch("agent.runner.pipeline.run_login_journey", return_value=mock_login_res),
        patch("agent.journeys.browser_agent.run_route_journey", return_value=mock_route_res),
        patch("agent.github.app.GitHubAppClient.create_check_run", new_callable=AsyncMock),
        patch("agent.github.app.GitHubAppClient.update_check_run", new_callable=AsyncMock),
    ):
        result = await run_pipeline(
            owner="acme-corp",
            repo="web",
            branch=branch,
            base_branch="main",
            sha=sha,
            intents=intents,
            test_type="functional+visual",
        )

        assert result["status"] == "success"
        assert result["risk_tag"] in ("Low", "Medium", "High")
        assert "login" in result["passed_journeys"]
        assert any("checkout" in j for j in result["passed_journeys"])
        assert result["baseline_comparison"]["has_new_regressions"] is False

        # Measured browser Web Vitals and real action timings must survive the
        # whole pipeline into the evaluator's report.
        quality = result["quality_dimensions"]
        assert quality["web_vitals"]["measured"] is True
        assert quality["web_vitals"]["lcp_ms"] == 1420.0
        # No interaction occurred -> INP stays None, never invented.
        assert quality["web_vitals"]["inp_ms"] is None
        assert "inp_ms" not in quality["web_vitals"]["measured_metrics"]
        assert quality["cost_metrics"]["total_actions_metered"] == 2
        assert quality["cost_metrics"]["avg_action_latency_ms"] == 200.0
        # This run recorded no LLM usage -> tokens/cost stay None (honest).
        assert quality["cost_metrics"]["total_tokens"] is None
        assert quality["cost_metrics"]["inference_cost_usd"] is None

        # Verify store updated to completed
        rec = run_store.find_latest_by_sha(branch=branch, sha=sha)
        assert rec is not None
        assert rec.status == "completed"

        # Timing must describe real phases and must include a total. Every
        # completed run used to report "0s" in the dashboard because no total was
        # ever recorded, and "analysis" and "journeys" always held the same value
        # because both timers started at the same instant.
        timing = result["timing"]
        assert timing["total_duration_s"] >= 0
        assert timing["analysis_duration_s"] >= 0
        assert timing["journeys_duration_s"] >= 0
        assert timing["total_duration_s"] == pytest.approx(
            timing["analysis_duration_s"] + timing["journeys_duration_s"], abs=0.01
        )
        # Top-level key the run list reads for its duration column.
        assert result["duration_s"] == timing["total_duration_s"]

        # The session-replay slot must always be reported (None when there was
        # only one route to record), so the dashboard can label the replay
        # honestly instead of claiming a stitched session that does not exist.
        assert "session_replay_url" in result
