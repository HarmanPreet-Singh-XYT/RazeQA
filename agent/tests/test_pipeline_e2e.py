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
async def test_run_pipeline_executes_exploratory_and_baseline():
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

        # Verify store updated to completed
        rec = run_store.find_latest_by_sha(branch=branch, sha=sha)
        assert rec is not None
        assert rec.status == "completed"
