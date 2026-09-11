"""Unit tests for FastAPI /analytics endpoints."""

import pytest
from fastapi.testclient import TestClient
from agent.main import app
from agent.api.runs import run_store


@pytest.fixture
def client():
    # Set bearer token header matching BearerAuthMiddleware default
    import os
    token = os.environ.get("AGENT_API_KEY", "test-key")
    os.environ["AGENT_API_KEY"] = token
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def test_get_analytics_overview(client):
    res = client.get("/analytics/overview")
    assert res.status_code == 200
    data = res.json()
    assert "metrics" in data
    assert "insights" in data
    assert data["metrics"]["total_runs"] >= 0
    assert "dimensions" in data["metrics"]


def test_get_run_quality_analytics(client):
    rec = run_store.create(
        branch="feat/test-analytics",
        sha="abc12345",
        scope="changed",
    )
    res = client.get(f"/analytics/runs/{rec.run_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["run_id"] == rec.run_id
    assert "quality_report" in data
    assert "per_path_analysis" in data["quality_report"]


def test_post_ai_query(client):
    res = client.post("/analytics/query", json={"query": "Why did checkout fail?"})
    assert res.status_code == 200
    data = res.json()
    assert "answer" in data
    assert "confidence" in data
