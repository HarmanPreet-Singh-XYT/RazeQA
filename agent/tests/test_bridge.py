"""Unit and integration tests for Day 2 Coding Agent Bridge."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from agent.api.runs import run_store
from agent.bridge.models import FileIntentStore, IntentEvent
from agent.main import app


@pytest.fixture
def temp_intent_store(tmp_path: Path) -> FileIntentStore:
    return FileIntentStore(base_dir=tmp_path / "intents")


def test_intent_store_file_persistence(temp_intent_store: FileIntentStore) -> None:
    branch = "feature/login-fix"
    event1 = IntentEvent(
        files=["app/login/page.tsx"],
        action="edit",
        prompt_summary="Fix login validation error display",
        reasoning="Error message was persisting after user re-typed password",
        branch=branch,
        sha="abc1234",
    )
    temp_intent_store.append(branch, event1)

    event2 = IntentEvent(
        files=["app/login/form.tsx"],
        action="create",
        prompt_summary="Extract reusable form component",
        reasoning="Encapsulate inputs for easier testing",
        branch=branch,
        sha="abc1234",
    )
    temp_intent_store.append(branch, event2)

    events = temp_intent_store.get(branch)
    assert len(events) == 2
    assert events[0].files == ["app/login/page.tsx"]
    assert events[0].prompt_summary == "Fix login validation error display"
    assert events[1].action == "create"

    temp_intent_store.clear(branch)
    assert len(temp_intent_store.get(branch)) == 0


def test_bridge_rest_endpoints() -> None:
    client = TestClient(app)
    branch = "test-rest-branch"

    # Clean branch first
    client.delete(f"/bridge/intents/{branch}")

    # POST event
    payload = {
        "files": ["app/page.tsx"],
        "action": "edit",
        "prompt_summary": "Update landing headline",
        "reasoning": "Modernize tagline for marketing demo",
        "branch": branch,
        "sha": "def5678",
    }
    post_res = client.post("/bridge/events", json=payload)
    assert post_res.status_code == 200
    data = post_res.json()
    assert data["received"] is True
    assert data["count"] >= 1

    # GET intents
    get_res = client.get(f"/bridge/intents/{branch}")
    assert get_res.status_code == 200
    events = get_res.json()
    assert len(events) >= 1
    assert events[-1]["prompt_summary"] == "Update landing headline"

    # DELETE intents
    del_res = client.delete(f"/bridge/intents/{branch}")
    assert del_res.status_code == 200
    assert len(client.get(f"/bridge/intents/{branch}").json()) == 0


def test_bridge_websocket_stream() -> None:
    client = TestClient(app)
    branch = "test-ws-branch"
    client.delete(f"/bridge/intents/{branch}")

    with client.websocket_connect(f"/bridge/ws/{branch}") as websocket:
        payload = {
            "files": ["app/dashboard/layout.tsx"],
            "action": "edit",
            "prompt_summary": "Add sidebar navigation items",
            "reasoning": "Expose settings and logs links",
            "sha": "111222333444",
        }
        websocket.send_json(payload)
        response = websocket.receive_json()

        assert response["received"] is True
        assert response["branch"] == branch
        assert response["count"] == 1
        assert response["event"]["files"] == ["app/dashboard/layout.tsx"]

    # Verify persisted in intent store
    res = client.get(f"/bridge/intents/{branch}")
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_runs_freshness_dedup() -> None:
    client = TestClient(app)
    run_store.clear()

    branch = "main"
    sha1 = "a1b2c3d4e5f60000111122223333444455556666"

    # 1. First trigger for sha1 -> should queue fresh run
    res1 = client.post(
        "/runs",
        json={"branch": branch, "sha": sha1, "scope": "changed", "test_type": "functional"},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["status"] == "queued"
    assert data1["fresh"] is True
    run_id1 = data1["run_id"]

    # 2. Trigger while queued/running -> indicates already in progress
    res_in_prog = client.post(
        "/runs",
        json={"branch": branch, "sha": sha1, "scope": "changed", "test_type": "functional"},
    )
    assert res_in_prog.status_code == 200
    assert res_in_prog.json()["fresh"] is False
    assert res_in_prog.json()["run_id"] == run_id1

    # 3. Simulate completion of run_id1
    run_store.update(
        run_id=run_id1,
        status="completed",
        result={"passed": True, "journeys": ["login", "dashboard"]},
        completed=True,
    )

    # 4. Trigger again with identical sha1 -> should return cached result
    res_cached = client.post(
        "/runs",
        json={"branch": branch, "sha": sha1, "scope": "changed", "test_type": "functional"},
    )
    assert res_cached.status_code == 200
    data_cached = res_cached.json()
    assert data_cached["status"] == "cached"
    assert data_cached["fresh"] is False
    assert data_cached["run_id"] == run_id1
    assert data_cached["result"]["passed"] is True

    # 5. Trigger with new sha2 -> should queue fresh run
    sha2 = "b2c3d4e5f6a10000111122223333444455556666"
    res2 = client.post(
        "/runs",
        json={"branch": branch, "sha": sha2, "scope": "changed", "test_type": "functional"},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["status"] == "queued"
    assert data2["fresh"] is True
    assert data2["run_id"] != run_id1
