from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
import pytest
from agent.main import app
from agent.api.runs import run_store
from conftest import AUTH_HEADERS


@pytest.fixture
def client():
    return TestClient(app)


def test_apply_run_fix_not_found(client):
    res = client.post(
        "/runs/nonexistent_run/apply",
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_apply_run_fix_no_proposals(client):
    record = run_store.create(branch="feat/test", sha="1234567")
    run_store.update(record.run_id, status="completed", result={"passed": True})

    res = client.post(
        f"/runs/{record.run_id}/apply",
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 400
    assert "no fix proposals" in res.json()["detail"].lower()


@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_apply_run_fix_success_local(mock_pipeline, client, tmp_path, monkeypatch):
    # Setup a mock target file
    test_file = tmp_path / "components" / "button.tsx"
    test_file.parent.mkdir(parents=True, exist_ok=True)
    test_file.write_text("export function Button() { return <button className='bg-red-500'>Click</button>; }")

    monkeypatch.chdir(tmp_path)

    # Create run with fix proposal targeting components/button.tsx
    record = run_store.create(branch="feat/test-fix", sha="abcdef1")
    fix_proposal = {
        "summary": "Fix button color to emerald",
        "target_files": ["components/button.tsx"],
        "paradigm": "tailwind",
        "patches": [
            {
                "file_path": "components/button.tsx",
                "original_snippet": "bg-red-500",
                "replacement_snippet": "bg-emerald-500",
            }
        ],
        "unified_diff": "- bg-red-500\n+ bg-emerald-500",
    }
    run_store.update(
        record.run_id,
        status="failed",
        result={
            "fix_proposals": [fix_proposal],
            "owner": "local",
            "repo": "web",
        },
    )

    res = client.post(
        f"/runs/{record.run_id}/apply",
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "applied"
    assert "components/button.tsx" in data["applied_files"]
    assert "new_run_id" in data

    # Verify target file updated
    content = test_file.read_text()
    assert "bg-emerald-500" in content
    assert "bg-red-500" not in content

    # Verify re-verification dispatched
    assert mock_pipeline.called


@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_trigger_run_caching_and_force(mock_pipeline, client):
    # Pre-seed a completed run
    record = run_store.create(branch="main", sha="abc999", scope="changed", repo="acme/app")
    run_store.update(record.run_id, status="completed", result={"passed_journeys": ["home"]})

    # Trigger with same SHA and scope without force -> should be a cache hit
    res = client.post(
        "/runs",
        json={
            "branch": "main",
            "sha": "abc999",
            "scope": "changed",
            "repo": "acme/app",
            "force": False,
        },
        headers=AUTH_HEADERS,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "cached"
    assert data["fresh"] is False
    assert data["tokens_saved_estimate"] == 15000

    # Trigger with force=True -> should bypass cache and dispatch new run
    res_force = client.post(
        "/runs",
        json={
            "branch": "main",
            "sha": "abc999",
            "scope": "changed",
            "repo": "acme/app",
            "force": True,
            "pr_number": 42,
            "commit_range": "main..feat",
        },
        headers=AUTH_HEADERS,
    )
    assert res_force.status_code == 200
    data_force = res_force.json()
    assert data_force["status"] == "queued"
    assert data_force["fresh"] is True
    assert mock_pipeline.called


@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_trigger_run_forced_rate_limiting(mock_pipeline, client):
    """Verify that force=True is rate limited to max 10 requests per minute per repo."""
    repo = "rate-limit-test/app"

    # Send 10 forced requests - should all succeed
    for i in range(10):
        res = client.post(
            "/runs",
            json={
                "branch": "main",
                "sha": f"sha_{i}",
                "scope": "changed",
                "repo": repo,
                "force": True,
            },
            headers=AUTH_HEADERS,
        )
        assert res.status_code == 200, f"Request {i+1} failed with {res.status_code}: {res.text}"

    # 11th forced request should be rate-limited with HTTP 429
    res_blocked = client.post(
        "/runs",
        json={
            "branch": "main",
            "sha": "sha_blocked",
            "scope": "changed",
            "repo": repo,
            "force": True,
        },
        headers=AUTH_HEADERS,
    )
    assert res_blocked.status_code == 429
    assert "rate limit exceeded" in res_blocked.json()["detail"].lower()


